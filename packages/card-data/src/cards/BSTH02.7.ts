import type { CardDefinition, Timing } from "@orica/rules-core";

function aliceHouseRebirthEffect(
  timing: Timing
): NonNullable<CardDefinition["effects"]>[number] {
  return {
    timing,
    executionMode: "optional",
    condition: [{ kind: "count_value", player: "self", max: 9 }],
    steps: [
      {
        action: {
          kind: "rebirth",
          maxCount: 9,
          allowPostRebirthCorePlacementForLvDeficit: true,
          postRebirthChoice: {
            kind: "core_distribute",
            minimum: "back_face_lv",
          },
        },
      },
    ],
    textRef: [0, 1],
  };
}

export const BSTH02_7_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH02.7-C01",
    orikaId: 459,
    orikaIndex: 90,
    name: "戦操「ドールズウォー」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "手札にあるこのカードは、自分のメインステップ終了時に使用できる。",
      "",
      "メイン",
      "自分のネクサスが黄1色のみで2つ以上のとき、このステップの間、相手のネクサス/創界神ネクサス/創界石ネクサス/ミラージュの効果は発揮されない。",
      "メインステップ終了時に使用していたとき、「このターンの間」に変更できる。",
      "その後、「ステップの間」で発揮したとき、自分はデッキの下から1枚ドローできる。",
      "",
      "フラッシュ",
      "このターンの間、スピリット/アルティメット1体をBP+3000する。",
      "または、次の自分のスタートステップまで、お互い、ライフにコアを置けない。",
    ],
    keywordTags: [],
    tribe: "導魔",
    image: "images/BSTH02.7-C01.webp",
    rarity: "C",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    // メイン本来の使用に加え、終了時にはターン持続へ変更できる。
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        timingScope: { player: "self", period: "main", subPhase: "end" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            colors: ["yellow"],
            colorCount: "mono",
            minCount: 2,
          },
          {
            kind: "field_all_match",
            player: "self",
            filter: {
              targetsGrandwalker: true,
              targetsGrandstone: true,
              filterOr: [
                { category: ["spirit", "brave", "ultimate", "magic"] },
                {
                  category: ["nexus"],
                  colors: ["yellow"],
                  colorCount: "mono",
                  targetsGrandwalker: true,
                  targetsGrandstone: true,
                },
              ],
            },
          },
        ],
        steps: [
          {
            id: "suppress_nexus",
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["nexus"] },
                    { category: ["nexus"], targetsGrandwalker: true },
                    { category: ["nexus"], targetsGrandstone: true },
                  ],
                },
                count: "all",
              },
              duration: { scope: "step" },
            },
            choice: [
              {
                action: {
                  kind: "suppress_effect",
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: {
                      filterOr: [
                        { category: ["nexus"] },
                        { category: ["nexus"], targetsGrandwalker: true },
                        { category: ["nexus"], targetsGrandstone: true },
                      ],
                    },
                    count: "all",
                  },
                  duration: { scope: "turn" },
                },
              },
            ],
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "suppress_nexus",
              choiceIndex: 0,
            },
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                zone: "mirage",
                filter: {},
                count: "all",
              },
              duration: { scope: "step" },
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "suppress_nexus",
              choiceIndex: 1,
            },
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                zone: "mirage",
                filter: {},
                count: "all",
              },
              duration: { scope: "turn" },
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_choice",
              stepId: "suppress_nexus",
              choiceIndex: 0,
            },
            executionMode: "optional",
            action: { kind: "draw", count: 1, position: "bottom" },
          },
        ],
        textRef: [0, 2, 3, 4, 5],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "either",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              amount: 3000,
              duration: { scope: "turn" },
            },
            choice: [
              {
                action: {
                  kind: "restrict_core_placement",
                  player: "either",
                  duration: { scope: "step", step: "start", whose: "self" },
                },
              },
            ],
          },
        ],
        textRef: [7, 8, 9],
      },
      {
        timing: { kind: "activated", mode: "main" },
        timingScope: { player: "self", period: "main" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["nexus"],
            colors: ["yellow"],
            colorCount: "mono",
            minCount: 2,
          },
          {
            kind: "field_all_match",
            player: "self",
            filter: {
              targetsGrandwalker: true,
              targetsGrandstone: true,
              filterOr: [
                { category: ["spirit", "brave", "ultimate", "magic"] },
                {
                  category: ["nexus"],
                  colors: ["yellow"],
                  colorCount: "mono",
                  targetsGrandwalker: true,
                  targetsGrandstone: true,
                },
              ],
            },
          },
        ],
        steps: [
          {
            id: "suppress_nexus",
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["nexus"] },
                    { category: ["nexus"], targetsGrandwalker: true },
                    { category: ["nexus"], targetsGrandstone: true },
                  ],
                },
                count: "all",
              },
              duration: { scope: "step" },
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                zone: "mirage",
                filter: {},
                count: "all",
              },
              duration: { scope: "step" },
            },
          },
          {
            connector: "sequential",
            executionMode: "optional",
            action: { kind: "draw", count: 1, position: "bottom" },
          },
        ],
        textRef: [0, 2, 3, 4, 5],
      },
    ],
  },
  {
    cardNo: "BSTH02.7-C02",
    orikaId: 460,
    orikaIndex: 91,
    name: "紅毛の和蘭人形",
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
        requiredCores: 2,
        bp: 6000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 8000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの下から2枚ドローできる。または、〔ゲームに1回:同名〕自分のトラッシュにある系統：「幻想」と「動玩」を持つカード3枚を除外することで、次の自分のスタートステップまで、相手のスピリット/アルティメット/ネクサス/創界神ネクサスのシンボルを0に固定する。",
      "",
      "Lv3『自分のアタックステップ』",
      "このスピリットは系統：「起幻」を持ち、相手のスピリット/アルティメット/ブレイヴ/ネクサス/スタックの効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・動玩",
    image: "images/BSTH02.7-C02.webp",
    rarity: "C",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 二択: デッキ下から2枚ドロー (既定) OR 〔ゲームに1回:同名〕トラッシュの幻想&動玩3枚除外
      // → 次の自分のスタートステップまで相手の全シンボルを0に固定。choice + ref_choice +
      // conditional_cost で排他化 (BSTH02-C03 effects[0] 同型)。「次の自分のスタートステップ
      // まで」は duration{scope:"step",step:"start",whose:"self"}
      // (ENGINE: step-scope duration の whose フィルタを本カードで新規配線)。
      {
        timing: {
          kind: "card_event",
          event: "summon",
        },
        executionMode: "optional",
        steps: [
          {
            id: "mode",
            action: {
              kind: "draw",
              count: 2,
              position: "bottom",
            },
            choice: [
              {
                action: {
                  kind: "remove_from_game",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "trash",
                    filter: { tribesRequired: ["幻想", "動玩"] },
                    count: 3,
                  },
                },
                usageLimit: { kind: "per_card_name", duration: "game" },
                // トラッシュに幻想&動玩 AND 系統カード3枚未満なら選択不可
                // (remove_from_game の count は候補不足時に取れるだけ取ってしまうため、
                // 「3枚を除外することで」の全額コスト性を condition で別途保証する)。
                condition: [
                  {
                    kind: "field_has",
                    player: "self",
                    zone: "trash",
                    tribesRequired: ["幻想", "動玩"],
                    minCount: 3,
                  },
                ],
              },
            ],
          },
          {
            action: {
              kind: "override_properties",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    { category: ["spirit"] },
                    { category: ["ultimate"] },
                    { category: ["nexus"], targetsGrandwalker: true },
                  ],
                },
                count: "all",
              },
              properties: { symbols: [], symbolCountFixed: true },
              duration: { scope: "step", step: "start", whose: "self" },
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "mode",
              choiceIndex: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1],
      },
      // Lv3『自分のアタックステップ』このスピリットは系統：「起幻」を持ち、相手のスピリット/
      // アルティメット/ブレイヴ/ネクサス/スタックの効果を受けない。
      // sourceScope.categories=["spirit","ultimate","brave","nexus"] で発生源カテゴリ限定
      // (BSTH07.8-X01 effects[6,7] と同型 immunitySourceScope 先例)。「自分のアタックステップ」
      // 限定は timingScope:{player:self,period:"attack"} で表現 (同先例)。
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
              kind: "override_properties",
              target: { kind: "self" },
              properties: { addTribes: ["起幻"] },
              duration: { scope: "while_on_field" },
            },
          },
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              sourceScope: {
                categories: ["spirit", "ultimate", "brave", "nexus"],
                activatedTimings: ["stack"],
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
    ],
  },
  {
    cardNo: "BSTH02.7-C03",
    orikaId: 461,
    orikaIndex: 92,
    name: "輪廻の西蔵人形",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "guide"],
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
      "自分はデッキの上から3枚オープンできる。その中のマジックカード1枚を手札に加えられる。残ったカードは破棄する。その後、手札に加えなかったとき、〔ステップに1回:同名〕トラッシュにある系統：「導魔」/「動玩」/「四道」/「楽族」を持つ黄1色のスピリットカード/ネクサスカード1枚を手札に戻せる。",
      "",
      "Lv2-Lv3",
      "自分の手札が5枚以下の間、自分の手札/手元は相手の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "幻想・動玩",
    image: "images/BSTH02.7-C03.webp",
    rarity: "C",
    pack: "BSTH02.7 夢違科学世紀",
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
            id: "reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["magic"],
                  },
                },
              ],
              remainder: "trash",
            },
          },
          {
            executionMode: "optional",
            stepCondition: {
              kind: "ref_count",
              stepId: "reveal",
              result: "hand_added",
              min: 0,
              max: 0,
            },
            usageLimit: { kind: "per_card_name", duration: "step" },
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  category: ["spirit", "nexus"],
                  colorCount: "mono",
                  colors: ["yellow"],
                  tribes: ["導魔", "動玩", "四道", "楽族"],
                },
                count: 1,
              },
              from: {
                zone: "trash",
                player: "self",
                filter: {
                  category: ["spirit", "nexus"],
                  colorCount: "mono",
                  colors: ["yellow"],
                  tribes: ["導魔", "動玩", "四道", "楽族"],
                },
              },
              to: { zone: "hand" },
              count: 1,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3 自分の手札が5枚以下の間、自分の手札/手元は相手の効果を受けない。
      // effect_immunity(target.zone:["hand","set_aside"]) = ゾーン単位免疫の初出primitive
      // (ENGINE-effect-immunity-hand-zone-scope)。dynamicTargetFilterFromEffectTarget を
      // zone 対応に一般化し、global CE (targetFilter) として動的マッチさせる
      // (per-instance snapshot CE だと recomputeContinuousEffects の
      // 「targetInstanceId 付き CE は対象カードが field を離れたら除去」規約に抵触し、
      // 手札/手元カードへ付与した瞬間に消えてしまうため使えない)。
      {
        timing: {
          kind: "continuous",
        },
        condition: [
          {
            kind: "min_level",
            value: 2,
          },
          {
            kind: "hand_count",
            player: "self",
            max: 5,
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
                zone: ["hand", "set_aside"],
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
    cardNo: "BSTH02.7-C04",
    orikaId: 462,
    orikaIndex: 93,
    name: "霧の倫敦人形",
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
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの上から3枚オープンできる。その中の黄1色の導界者ネクサスカード1枚と、系統：「導魔」/「動玩」/「四道」を持つ黄1色のカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv1-Lv2-Lv3",
      "系統：「幻想」と「導魔」/「動玩」を持つコスト4以上の自分のスピリットすべては相手の効果でフィールドから手札/手元/デッキに戻らない。",
    ],
    keywordTags: [],
    tribe: "幻想・動玩",
    image: "images/BSTH02.7-C04.webp",
    rarity: "C",
    pack: "BSTH02.7 夢違科学世紀",
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
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    colorCount: "mono",
                    category: ["nexus"],
                    colors: ["yellow"],
                    tribes: ["導界者"],
                  },
                },
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    colorCount: "mono",
                    colors: ["yellow"],
                    tribes: ["導魔", "動玩", "四道"],
                  },
                },
              ],
              remainder: "trash",
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
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["導魔", "動玩"],
                  tribesRequired: ["幻想"],
                  minCost: 4,
                },
                count: "all",
              },
              // 「手札/手元/デッキに戻らない」= hand/set_aside (bounce) + deck (send_to_deck)
              // の2 outcome (BounceAction.destination の分類、model.ts 参照)。
              resistsOutcome: ["bounce", "send_to_deck"],
              source: "opponent_effect",
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
    cardNo: "BSTH02.7-C05",
    orikaId: 463,
    orikaIndex: 94,
    name: "戦符「リトルレギオン」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "トラッシュにあるこのカードは手札/デッキに戻らず、手元からフラッシュ効果を使用したこのカードは、効果発揮後に除外する。",
      "手札/手元にあるこのカードは、相手の効果で自分のライフが減るとき、破棄することで自分のライフは減らない。",
      "",
      "フラッシュ",
      "自分のスピリット1体を回復させる。または、魂状態を含む自分の導界者ネクサスの「アリス・マーガトロイド」がいるとき、自分のカウント1以上なら、このターンの間、自分のライフは1しか減らない。",
    ],
    keywordTags: ["soul_state"],
    tribe: "動玩",
    image: "images/BSTH02.7-C05.webp",
    rarity: "C",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // トラッシュのこのカードは(誰の効果であれ)手札/デッキに戻らない。
      // effect_resistance(source:"all")。BSTS01 呪鬼/暴嵐 Lv2-3 (effects[5,6]) と同型、
      // scope のみ while_on_field → while_in_trash (applicability.zone:"trash" と対の
      // trash-zone 版、BSKB01/BSTH002/BSSG01 の effect_immunity 先例と同じペア構成)。
      {
        applicability: { zone: "trash" },
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: ["bounce", "send_to_deck"],
              source: "all",
              duration: { scope: "while_in_trash" },
            },
          },
        ],
        textRef: [0],
      },
      // 手札/手元にあるこのカードは、相手の効果で自分のライフが減るとき、破棄することで
      // 自分のライフは減らない。= life_damage_interception(replace, cause:opponent_effect,
      // discardCostGate:{zones:[hand,set_aside]})。BSTH07-R10/BSTH02.7-TX01(A)/BSTH04-C11 の
      // life_damage_interception 先例と同様 prevent_life_damage(silent-disabled) は不採用。
      // duration は permanent（zone チェックは discardCostGate 消費側で毎回行うため duration
      // expiry には依存しない。破棄されれば zone を離れ、以後この CE は自然に無効化する）。
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent_effect",
              mode: "replace",
              discardCostGate: { zones: ["hand", "set_aside"] },
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [1],
      },
      // [3,4] フラッシュ二択: 「スピリット1体回復」or「魂状態を含む自分の導界者ネクサス
      //   『アリス・マーガトロイド』がいて自分のカウント1以上なら、このターンライフは1しか
      //   減らない」。BSFT01-TR09(B)[7,8] と同型の field_has(includeSoulState) +
      //   count_value + life_damage_interception(mode:turn_cap) を choice 変種として排他化
      //   (choices[0]=recover / choices[1]=turn_cap、後者だけ branch-local condition でゲート)。
      //   category:["nexus"] + tribes:["導界者"] で BSTH02-M02「[妖々夢]アリス・マーガトロイド」
      //   (category:spirit、同名別カード) を誤って一致させない (adversarial verifier lens1 指摘)。
      // [0] 後半「手元からフラッシュ効果を使用したこのカードは、効果発揮後に除外する」を
      //   trailing step で表現 (ENGINE-magic-activation-source-zone-condition)。
      //   stepCondition:activation_zone(zones:["set_aside"]) が手元発動時のみ true になり、
      //   remove_from_game(target:self) が in_use のこのカードを removed_from_game へ動かす。
      //   moveMagicCardToTrash(requireInUse:true) はその後 zone!=="in_use" で no-op になるため、
      //   手元発動時はトラッシュ移動が自然に除外へ置き換わる (手札発動時は zone 不一致で通常通りトラッシュへ)。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
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
            choice: [
              {
                label: "ライフ減少上限",
                condition: [
                  {
                    kind: "field_has",
                    player: "self",
                    category: ["nexus"],
                    tribes: ["導界者"],
                    cardNames: [{ contains: "アリス・マーガトロイド" }],
                    includeSoulState: true,
                  },
                  { kind: "count_value", player: "self", min: 1 },
                ],
                action: {
                  kind: "life_damage_interception",
                  player: "self",
                  cause: "any",
                  mode: "turn_cap",
                  cap: 1,
                  duration: { scope: "turn" },
                },
              },
            ],
          },
          {
            connector: "after_triggers",
            stepCondition: { kind: "activation_zone", zones: ["set_aside"] },
            action: {
              kind: "remove_from_game",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [0, 3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH02.7-C06",
    orikaId: 464,
    orikaIndex: 95,
    name: "試験中「レベルティターニア」",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "手札にあるこのカードは、相手の効果を受けない。",
      "",
      "フラッシュ",
      "相手のスピリット/アルティメット2体を指定し、このターンの間、自分のライフは指定した対象によって減らない。または、〔ゲームに1回:同名〕手札/手元にある系統：「幻想」/「動玩」を持つコスト7以下のスピリットカード2枚までを軽減シンボルすべてを満たして召喚できる。このとき、トラッシュにある黄1色のカード8枚までを除外することで、除外したカード4枚につき、召喚するスピリットカード1枚のコストを0にする。",
    ],
    keywordTags: [],
    tribe: "動玩",
    image: "images/BSTH02.7-C06.webp",
    rarity: "C",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 手札にあるこのカードは、相手の効果を受けない。
      // SSOT: BSGE01-C16 effects[0] と shape のみ同期 (applicability.zone:["hand"] +
      // effect_immunity self permanent)。
      // 現状 runtime sleeping: continuous-effect-rebuild.ts REBUILD_ZONES は
      // {field, mirage, burst} のみで "hand" 未収録のため、手札ゾーンの continuous CE は
      // activeContinuousEffects に登録されず、isCardImmuneToOpponentEffect 経路では
      // silent。engine 側で hand ゾーン CE 登録が landing したとき自動有効化される。
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
      // フラッシュ二択: branch1「相手のスピリット/アルティメット2体を指定し、このターンの間、
      // 自分のライフは指定した対象によって減らない」= life_damage_interception(replace) +
      // attackerSelectedTarget + target.count:2 (BSSG01-C06 effects[5,6] count:1 版と同型、
      // count のみ2に拡張。target選択・attackerInstanceIds格納・prevention.instanceIds照合は
      // いずれも配列汎用実装のため新規primitive不要、trivial reuse)。
      // branch2「〔ゲームに1回:同名〕幻想/動玩コスト7以下スピリット2枚まで軽減シンボル
      // すべて満たして召喚できる。トラッシュの黄1色カード8枚まで除外することで、除外4枚に
      // つき召喚スピリット1枚のコストを0にする」= choice[0] (BSTH02.7-C05[3,4]
      // 「回復 or ライフ減少上限」と同型の相互排他 choice) の summon action。
      // 対象選択は summon.target:from_zone + count:{min:0,max:2} (BSSA01-X02 effects[2,3]
      // 「夜錆カード2枚までコストなしで召喚」と同型、target-resolution は generic pending
      // target selection 経路で既に配線済のため新規実装不要)。
      // グループ化コストオーバーライドは新規 groupedExcludeOverride (SummonAction拡張、
      // PendingGroupedSummonCostOverrideChoice)。既存 cost_modify useCostPayment.exclude は
      // 「発動元カード自身への線形 -1/枚」専用 (BSTH02.7-M01/X02 precedent) で、本カードの
      // 「複数の異なる召喚対象へグループ単位でコスト0オーバーライドを配分」には非対応のため
      // 別 primitive として新設 (mechanics/grouped-summon-cost-override-choice.ts)。
      // costModifier:"full_reduction" はグループ化オーバーライド対象外 (除外未達分) の召喚
      // 対象へ適用される。PendingGroupedSummonCostOverrideChoice.nonOverrideFullReduction 経由で
      // pending 解決時の再構成 v1Action へ転写し、resolveSummonActionCost は
      // perCardOverride (オーバーライド対象固定コスト) を fullReduction より優先する。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "replace",
              attackerSelectedTarget: true,
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 2,
              },
              duration: { scope: "turn" },
            },
            choice: [
              {
                label: "幻想/動玩スピリット召喚",
                usageLimit: { kind: "per_card_name", duration: "game" },
                action: {
                  kind: "summon",
                  target: {
                    kind: "from_zone",
                    zone: ["hand", "set_aside"],
                    filter: {
                      category: ["spirit"],
                      tribes: ["幻想", "動玩"],
                      maxCost: 7,
                    },
                    count: { min: 0, max: 2 },
                  },
                  costModifier: "full_reduction",
                  groupedExcludeOverride: {
                    sourceZone: "trash",
                    maxCount: 8,
                    groupSize: 4,
                    filter: { colors: ["yellow"], colorCount: "mono" },
                    overrideCost: 0,
                  },
                },
              },
            ],
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSTH02.7-CX01",
    orikaId: 465,
    orikaIndex: 96,
    name: "［魔導と叡智の契約者］アリス・マーガトロイド",
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
        requiredCores: 0,
        requiredCount: 1,
        bp: 0,
      },
    ],
    symbolColors: ["yellow", "guide"],
    symbolColorEntries: [["yellow", "guide"]],
    textLines: [
      "【真・導託：〔動玩/四道/導魔＆コスト3以上〕〔転醒ネクサス〕】",
      "◆ 対象の自分のスピリット/ネクサスを召喚/配置したとき、このネクサスにコア+1できる。",
      "◆ 〔ターンに1回:同名〕このネクサスを配置したとき、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき、このネクサスにコア+1する。",
      "",
      "【復活】メイン〔ターンに1回:同名〕魂状態のこのカードは配置できる。",
      "",
      "【契約技：3/4】Lv1-Lv2 フラッシュ",
      "〔ターンに1回ずつ、このネクサスのコア3個/4個をボイドに置く〕3個置いたとき、自分はデッキの上から2枚をトラッシュに置くか、手札のカード1枚を手元に置く。その中に黄のカードがあれば、自分はデッキの下から1枚ドローできる。4個置いたとき、自分のスピリット1体を回復できる。",
      "",
      "【契約域】Lv2『自分のターン』",
      "自分の契約ネクサス以外の黄1色の導界者ネクサスすべてのLv2コストを3に固定する。",
    ],
    keywordTags: [
      "soul_state",
      "contract",
      "guided_nexus",
      "enter_field_core_placement_forbidden",
    ],
    tribe: "導界者・起幻・導魔",
    image: "images/BSTH02.7-CX01.webp",
    rarity: "CX",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    // 導託 [0,1,2] は grandwalkerData + エンジン基盤 (oracle-system) で表現。
    // 配置時神託 [2] は旧標準の同名在場ゲートではなく、本文どおり
    // 〔ターンに1回:同名〕で通常配置/復活配置を共有して制限する。
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "place"],
      oracleExecutionMode: "optional",
      placementOracle: { sameNameGate: false, turnLimit: "per_card_name" },
      oracleConditions: [
        // 〔動玩/四道/導魔＆コスト3以上〕は bullet1「対象の自分のスピリット/ネクサス」に
        // 合わせ categories で spirit/nexus に限定（マジックカードを対象外にする）。
        {
          tribes: ["動玩", "四道", "導魔"],
          minCost: 3,
          categories: ["spirit", "nexus"],
        },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      // 【契約技：3/4】Lv1-Lv2 フラッシュ〔ターンに1回ずつ、コア3個/4個をボイドに置く〕。
      // 契約技=神技扱い。コスト(コアN個→ボイド)・ターン制限は divineSkills 経路でエンジン検査。
      divineSkills: [
        {
          // 4個側: 自分のスピリット1体を回復。
          label: "contract_skill",
          coreCost: 4,
          timing: "flash",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          effects: [
            {
              textRef: [6, 7],
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  executionMode: "optional",
                  action: {
                    kind: "recover",
                    target: {
                      kind: "filter",
                      player: "self",
                      filter: { category: ["spirit"] },
                      count: 1,
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          effects: [
            {
              timing: { kind: "activated", mode: "flash" },
              textRef: [6, 7],
              steps: [
                {
                  id: "contract3-move",
                  action: {
                    kind: "move_card",
                    from: { zone: "deck", player: "self", position: "top" },
                    to: { zone: "trash" },
                    count: 2,
                  },
                  choice: [
                    {
                      action: {
                        kind: "move_card",
                        from: { zone: "hand", player: "self" },
                        to: { zone: "set_aside" },
                        count: 1,
                      },
                    },
                  ],
                },
                {
                  connector: "sequential",
                  executionMode: "optional",
                  stepCondition: {
                    kind: "ref_has_color",
                    stepId: "contract3-move",
                    colors: ["yellow"],
                  },
                  action: { kind: "draw", count: 1, position: "bottom" },
                },
              ],
            },
          ],
          // 3個側: 「デッキ上2枚トラッシュ」or「手札1枚を手元」を選び、黄があればデッキ下から
          // 1枚ドロー。汎用 choice / move_card / ref_has_color / 下からの draw で解決する。
          // コア3個コスト・ターン制限・Lv ゲートも divineSkills 経路で検査する。
          label: "contract_skill",
          coreCost: 3,
          timing: "flash",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
        },
      ],
    },
    effects: [
      // 【復活】メイン〔ターンに1回:同名〕魂状態のこのカードは配置できる。
      //   applicability.soulState + place(self) で魂状態からの配置として扱う。
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        applicability: { soulState: true },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "place",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [4],
      },
      // 【契約技：3/4】(flash) は grandwalkerData.divineSkills で表現（上記参照）。
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
        timingScope: { player: "self", period: "turn" },
        steps: [
          {
            action: {
              kind: "override_properties",
              // levelCost（Lv別必要コア数の絶対値上書き、dsl-types.ts:2217）で「Lv2コストを3に固定」
              // を表現。「契約ネクサス以外」は isContract:false で全契約ネクサスを除外する。
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  isContract: false,
                  category: ["nexus"],
                  colors: ["yellow"],
                  colorCount: "mono",
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                },
                count: "all",
                excludeSelf: true,
              },
              properties: { levelCost: { lv2: 3 } },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSTH02.7-M01",
    orikaId: 466,
    orikaIndex: 97,
    name: "博愛のオルレアン人形",
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
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 4,
        bp: 14000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1 このカードを召喚するとき、自分のトラッシュにあるカード2枚までを除外し、除外したカード1枚につきコストを-1する。",
      "",
      "Lv1-Lv2-Lv3『このスピリットの召喚/アタック時』",
      "〔ターンに1回:同名〕相手のネクサス1つをデッキの下に戻せる。",
      "",
      "Lv1-Lv2-Lv3",
      "本来のコストを含むコストが5～8の系統：「導魔」/「動玩」を持つ自分の黄のスピリットは相手の効果で破壊/消滅したとき、同じ状態でフィールドに残せる。",
      "",
      "Lv2-Lv3『自分のアタックステップ』",
      "相手は効果でステップ/ターンを終了できない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・動玩",
    image: "images/BSTH02.7-M01.webp",
    rarity: "M",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1「このカードを召喚するとき、自分のトラッシュにあるカード2枚までを除外し、
      //   除外したカード1枚につきコストを-1する。」
      // 可変枚数トラッシュ除外コスト軽減 = cost_modify + useCostPayment.kind:"exclude"
      // (pendingSummonCostExcludeChoice が player 選択を解決、summon-cost-exclude-choice.ts)。
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { additionalCostValue: -1 },
              useCostPayment: {
                kind: "exclude",
                sourceZone: "trash",
                maxCount: 2,
              },
            },
          },
        ],
        textRef: [0],
      },
      // 『召喚/アタック時』〔ターンに1回:同名〕相手ネクサス1つをデッキ下へ。
      // 召喚・アタックを単一 effect の event 配列で表現し、per_card_name 制限を共有する
      // （別 effect に分けると effectLabel=effect:N が異なり「ターンに1回」が summon/attack で
      //  各1回ずつ計2回使えてしまう。BSTS01-M01[7,8] と同じ event 配列パターン）。
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                },
                count: 1,
              },
              position: "bottom",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv1-Lv2-Lv3: 本来コスト5-8の自分の黄導魔/動玩スピリットすべてへ、相手の効果による
      // 破壊/消滅を「同じ状態で残せる」(任意) triggered replacement を付与する。
      // grant_effect (P3-99) + card_event(destroy/vanish, cause:opponent_effect) +
      // stay_on_field は BSFT01/BSSG01/BSTH05.5 同型 SSOT (memory project_grant_effect_*)。
      // 2026-09-13 確定裁定: 印字コストと効果適用後のコストの両方が5～8。
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: {
                  category: ["spirit"],
                  colors: ["yellow"],
                  tribes: ["導魔", "動玩"],
                  minCost: 5,
                  maxCost: 8,
                  exclude: {
                    filterOr: [
                      { maxCost: 4, costBasis: "printed" },
                      { minCost: 9, costBasis: "printed" },
                    ],
                  },
                },
              },
              duration: { scope: "while_on_field" },
              grantedEffect: {
                timing: {
                  kind: "card_event",
                  event: ["destroy", "vanish"],
                  cause: ["opponent_effect"],
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
        textRef: [5, 6],
      },
      // Lv2-Lv3『自分のアタックステップ』相手は効果でステップ/ターンを終了できない。
      // timingScope:{player:"self",period:"attack"} で「自分のアタックステップ中のみ」を表現
      // (BSAZ03/BSRK01-C07/BSTH06 同型)。「アタックステップを終了できない」は
      // restrict_end_attack_step、「ターンを終了できない」は restrict_end_turn で表現。
      {
        timing: {
          kind: "continuous",
        },
        timingScope: { player: "self", period: "attack" },
        condition: [
          {
            kind: "min_level",
            value: 2,
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
              kind: "restrict_end_turn",
              player: "opponent",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSTH02.7-R01",
    orikaId: 467,
    orikaIndex: 98,
    name: "博愛の仏蘭西人形",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: ["yellow", "yellow", "yellow", "yellow"],
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
        requiredCores: 3,
        bp: 12000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3『このスピリットの召喚時』",
      "自分はデッキの下から2枚ドローできる。または、自分のトラッシュにあるマジックカード1枚を手札/手元/デッキの上に戻せる。その後、ドローしなかったとき、自分のカウント1以上なら、〔ステップに1回:同名〕系統：「幻想」/「導魔」/「動玩」を持つコスト7以下のスピリットカード1枚をコストを支払わずに召喚できる。",
      "",
      "Lv1-Lv2-Lv3",
      "系統：「幻想」と「導魔」/「動玩」を持つ自分のスピリットすべては相手の効果でコアが1個より少なくならない。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・動玩",
    image: "images/BSTH02.7-R01.webp",
    rarity: "R",
    pack: "BSTH02.7 夢違科学世紀",
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
            id: "mode",
            action: {
              kind: "draw",
              count: 2,
              position: "bottom",
            },
            choice: [
              {
                label: "手札に戻す",
                action: {
                  kind: "move_card",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "trash",
                    filter: { category: ["magic"] },
                    count: 1,
                  },
                  from: {
                    zone: "trash",
                    player: "self",
                    filter: { category: ["magic"] },
                  },
                  to: { zone: "hand" },
                  count: 1,
                },
              },
              {
                label: "手元に戻す",
                action: {
                  kind: "move_card",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "trash",
                    filter: { category: ["magic"] },
                    count: 1,
                  },
                  from: {
                    zone: "trash",
                    player: "self",
                    filter: { category: ["magic"] },
                  },
                  to: { zone: "set_aside" },
                  count: 1,
                },
              },
              {
                label: "デッキの上に戻す",
                action: {
                  kind: "move_card",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "trash",
                    filter: { category: ["magic"] },
                    count: 1,
                  },
                  from: {
                    zone: "trash",
                    player: "self",
                    filter: { category: ["magic"] },
                  },
                  to: { zone: "deck", position: "top" },
                  count: 1,
                },
              },
            ],
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "all",
              conditions: [
                { kind: "ref_choice", stepId: "mode", choiceIndex: 0 },
                { kind: "ref_succeeded", stepId: "mode" },
              ],
              not: true,
            },
            condition: [{ kind: "count_value", player: "self", min: 1 }],
            usageLimit: { kind: "per_card_name", duration: "step" },
            executionMode: "optional",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: "hand",
                filter: {
                  category: ["spirit"],
                  // textLines[1] は「幻想」/「導魔」/「動玩」(「と」を含まないフラットOR)。
                  // 同カード effects[1] textLines[4]「幻想」と「導魔」/「動玩」(AND+OR、
                  // tribesRequired:[幻想]+tribes:[導魔,動玩]) とは区別する
                  // (adversarial verifier 指摘: ／のみ=OR、と=AND+OR。コピペ誤りを訂正)。
                  tribes: ["幻想", "導魔", "動玩"],
                  maxCost: 7,
                },
                count: 1,
              },
              costModifier: "free",
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
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribesRequired: ["幻想"],
                  tribes: ["導魔", "動玩"],
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
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH02.7-TR01(A)",
    orikaId: 468,
    orikaIndex: 99,
    name: "アリス邸",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1【転醒：自分のカウント9以下（転醒は同時に使えない）】",
      "自分のトラッシュに黄1色のカードが増えた/入れ替わったか、このネクサスが相手によってフィールドを離れるとき、このネクサスを裏返せる。このとき、この転醒後スピリットに自分のフィールド/リザーブのコアを好きなだけ置ける。",
      "",
      "Lv1『自分のメインステップ』",
      "〔ターンに1回:同名〕自分の手札が4枚以下のとき、自分の導界者ネクサスの「アリス」のコア1個をボイドに置くことで、自分はデッキの上から1枚ドローする。",
    ],
    keywordTags: ["double_sided"],
    tribe: "幻想・導魔",
    image: "images/BSTH02.7-TR01(A).webp",
    rarity: "TR",
    pack: "BSTH02.7 夢違科学世紀",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      aliceHouseRebirthEffect({
        kind: "game_event",
        player: "self",
        event: "trash_increase",
        triggerFilter: { colors: ["yellow"], colorCount: "mono" },
      }),
      // Lv1『自分のメインステップ』〔ターンに1回:同名〕手札 4 枚以下のとき、自分の
      //   導界者ネクサスの「アリス」のコア 1 個をボイドに置くことで、デッキ上 1 枚ドロー。
      // - 手札 4 枚以下: condition: hand_count(player:"self", max:4) で activated availability に gate。
      //   evaluateCondition は legal-actions-availability.ts:2967-2979 で activated 効果走査時に
      //   呼ばれる SSOT。
      // - 〔ターンに1回:同名〕: usageLimit per_card_name turn（既出）。
      // - 発動コスト「アリスの導界者ネクサスのコア 1 個 → ボイド」: step0 core_move
      //   from:field_card(自分の category:nexus + tribes:["導界者"] + targetsGrandwalker:true +
      //   cardName:[{contains:"アリス"}]) to:void amount:1。
      //   - tribes:["導界者"] は 創界神 tribe と排他 (precedent: BSTH02-X02 effects[1] L1614)、
      //     targetsGrandwalker:true で導界者 nexus を候補化する
      //     ([[project_summon_effect_reactivation_pattern.md]] 末尾)。
      //   - cardName:[{contains:"アリス"}] は CardNameMatch contains 規約（dsl-types.ts:128、
      //     裁定 2026-06-05、[[project_card_name_reference_matching]]）で「アリス」を含むカード名
      //     ⇒ BSTH02.7-CX01「［魔導と叡智の契約者］アリス・マーガトロイド」(導界者 tribe) に一致。
      // - 「〜することで」連結: step1 draw の connector:"conditional_cost"。コア不足 / 候補不在で
      //   step0 が rollback された場合 step1 は実行されない（SSOT: BSTH02-X02 effects[1] 同型）。
      {
        executionMode: "optional",
        timing: {
          kind: "activated",
          mode: "main",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        condition: [{ kind: "hand_count", player: "self", max: 4 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["導界者"],
                  targetsGrandwalker: true,
                  cardName: [{ contains: "アリス" }],
                },
              },
              to: { kind: "void", player: "self" },
              amount: 1,
            },
          },
          {
            action: {
              kind: "draw",
              count: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [3, 4],
      },
      aliceHouseRebirthEffect({
        kind: "card_event",
        event: "leave_field",
        cause: ["opponent_effect", "battle"],
      }),
    ],
    isDoubleSided: true,
    backFace: {
      name: "［眠り魔女］アリス・マーガトロイド",
      printedCategory: "spirit",
      colors: ["yellow"],
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
          bp: 7000,
        },
      ],
      symbolColors: ["yellow"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。",
        "",
        "Lv1-Lv2 フラッシュ『相手のアタックステップ』",
        "〔ターンに1回:同名〕手札/手元の系統：「導魔」/「動玩」/「四道」/「楽族」を持つカード1枚を破棄することで、このターンの間、相手のスピリット/アルティメット/創界神ネクサス1つのシンボルを0に固定する。この効果は相手の効果では防げない。",
        "",
        "Lv2",
        "このスピリットが相手の効果でフィールドを離れるとき、自分の手札/手元1枚を破棄することで、同じ状態で残す。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・導魔",
      image: "images/BSTH02.7-TR01(B).webp",
      rarity: "TR",
      pack: "BSTH02.7 夢違科学世紀",
      cardNo: "BSTH02.7-TR01(B)",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          timingScope: { player: "opponent", period: "attack" },
          applicability: { level: { min: 1 } },
          executionMode: "optional",
          usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
          preventionLevel: "unpreventable",
          steps: [
            {
              id: "discard-tribe-card",
              action: {
                kind: "discard",
                player: "self",
                fromZone: ["hand", "set_aside"],
                filter: { tribes: ["導魔", "動玩", "四道", "楽族"] },
                count: 1,
              },
            },
            {
              connector: "conditional_cost",
              action: {
                kind: "override_properties",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    filterOr: [
                      { category: ["spirit", "ultimate"] },
                      { category: ["nexus"], targetsGrandwalker: "only" },
                    ],
                  },
                  count: 1,
                },
                properties: { symbols: [], symbolCountFixed: true },
                duration: { scope: "turn" },
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "card_event",
            event: "leave_field",
            cause: "opponent_effect",
          },
          applicability: { level: { min: 2 } },
          executionMode: "optional",
          steps: [
            {
              id: "discard-to-remain",
              action: {
                kind: "discard",
                player: "self",
                fromZone: ["hand", "set_aside"],
                count: 1,
              },
            },
            {
              connector: "conditional_cost",
              action: { kind: "stay_on_field", target: { kind: "self" } },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH02.7-TR02(A)",
    orikaId: 469,
    orikaIndex: 100,
    name: "アリスのマトリョーシカ",
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
        requiredCores: 2,
        bp: 6000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 8000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2-Lv3【転醒：自分のカウント9以下（転醒は同時に使えない）】",
      "自分のライフが増えた/減ったとき、このスピリットを裏返せる。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "自分のデッキの上から2枚をトラッシュに置ける。そうしたとき、トラッシュの《ソウルコア》以外のコア1個を自分のライフに置ける。",
      "",
      "Lv3『自分のメインステップ終了時』",
      "自分の手札/手元/トラッシュにある黄1色のカード1枚を除外することで、このターン中の次のバトル終了後まで、相手はスタック効果を発揮できず、このスピリットは可能ならこのターンの最初にアタックする。",
    ],
    keywordTags: ["double_sided"],
    tribe: "幻想・動玩",
    image: "images/BSTH02.7-TR02(A).webp",
    rarity: "TR",
    pack: "BSTH02.7 夢違科学世紀",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["core_placed_on_life", "reduce_life"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 9 }],
        steps: [{ action: { kind: "rebirth", maxCount: 9 } }],
        textRef: [0, 1],
      },
      // Lv2-Lv3『アタック時』デッキ上2枚をトラッシュに置ける→そうしたとき、トラッシュの
      //   《ソウルコア》以外のコア1個をライフに置ける。
      //   step[0] deck_reveal(remainder:trash, picks:[]) は「デッキの上から2枚をトラッシュ」。
      //   step[1] は connector:"conditional_result"（「そうしたとき」= 前段の成功が前提）で、
      //   デッキ破棄が成立（deck→trash の zone 変化）したときのみ実行。trash→life の core_move は
      //   generic だとソウルコアも対象になる（handleTrashToLife、持ち主選択 pendingLifeCoreSelection
      //   まで立つ）ため、印字「《ソウルコア》以外の」を effectKind:"normal_only" で明示除外する。
      //   両 step とも任意（executionMode:"optional"）。
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
              kind: "deck_reveal",
              revealCount: 2,
              picks: [],
              remainder: "trash",
            },
          },
          {
            connector: "conditional_result",
            executionMode: "optional",
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
              effectKind: "normal_only",
            },
          },
        ],
        textRef: [3, 4],
      },
      {
        // 「自分の手札/手元/トラッシュにある黄1色のカード1枚を除外することで」=
        // remove_from_game(target zone:[hand,set_aside,trash] + colors:[yellow]+colorCount:"mono")。
        // 「このターン中の次のバトル終了後まで、相手はスタック効果を発揮できず」=
        // restrict_stack + duration{scope:"battle", untilTurnEnd:true}（BSDB01-M02 先例と同型、
        // model.ts:663-667 の untilTurnEnd 定義通り）。
        // 「このスピリットは可能ならこのターンの最初にアタックする」=
        // force_first_attacker（ENGINE-force-first-attack-this-turn。今ターンまだバトルが
        // 終了していない間、他カードのアタック宣言を getAttackDeclarationBlockReason 側で
        // 抑止する。「可能なら」= 対象自身が疲労/離場等で宣言不能になれば自然解除）。
        timing: {
          whose: "self",
          kind: "phase",
          step: "main",
          subPhase: "end",
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
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  colors: ["yellow"],
                  colorCount: "mono",
                },
                count: 1,
                zone: ["hand", "set_aside", "trash"],
              },
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "restrict_stack",
              player: "opponent",
              duration: { scope: "battle", untilTurnEnd: true },
            },
          },
          {
            connector: "conditional_result",
            action: {
              kind: "force_first_attacker",
              target: "self",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "白亜の露西亜人形",
      printedCategory: "spirit",
      colors: ["yellow", "green"],
      cost: 4,
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
        "この面に裏返ったとき、フィールドに残り、カウント+1する。",
        "",
        "Lv1-Lv2-Lv3『このスピリットの転醒/アタック時』",
        "ボイドからコア1個ずつまでを自分のフィールドと導界者ネクサス1つに置ける。その後、相手のスピリット/アルティメット1体を疲労できる。",
        "",
        "Lv2-Lv3『自分のアタックステップ』",
        "相手のバースト効果を無効にする。",
      ],
      keywordTags: ["burst"],
      tribe: "幻想・動玩",
      image: "images/BSTH02.7-TR02(B).webp",
      rarity: "TR",
      pack: "BSTH02.7 夢違科学世紀",
      cardNo: "BSTH02.7-TR02(B)",
      effects: [
        {
          executionMode: "optional",
          timing: { kind: "card_event", event: ["rebirth", "attack"] },
          steps: [
            {
              executionMode: "optional",
              action: {
                kind: "core_distribute",
                from: { kind: "void", player: "self" },
                to: { kind: "filter", player: "self", filter: {}, count: 1 },
                amount: 1,
                mode: "one_each",
              },
            },
            {
              connector: "sequential",
              executionMode: "optional",
              action: {
                kind: "core_distribute",
                from: { kind: "void", player: "self" },
                to: {
                  kind: "filter",
                  player: "self",
                  filter: {
                    category: ["nexus"],
                    hasMechanic: ["guided"],
                    targetsGrandwalker: true,
                  },
                  count: 1,
                },
                amount: 1,
                mode: "one_each",
              },
            },
            {
              connector: "sequential",
              executionMode: "optional",
              action: {
                kind: "exhaust",
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
        {
          timing: { kind: "continuous" },
          applicability: { level: { min: 2 } },
          timingScope: { player: "self", period: "attack" },
          steps: [
            {
              action: {
                kind: "negate",
                negateTarget: "opponent_burst",
                duration: { scope: "step" },
              },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH02.7-TR03(A)",
    orikaId: 470,
    orikaIndex: 101,
    name: "アリスの人形工房",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: [],
    textLines: [
      "【解封：〔自分の「アリス邸」／系統：「導魔」／「動玩」を持つスピリットの召喚／転醒〕】",
      "◆ 解封条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。",
      "",
      "Lv1【転醒：自分のカウント9以下（転醒は同時に使えない）】",
      "このネクサスのコアが3個以上になったとき、このネクサスを裏返せる。（置かれているコアすべてはボイドに置かれる）このとき、この転醒後ブレイヴは自分のスピリットに合体できる。この転醒で【解封】はできない。",
      "",
      "【神秘】Lv1『自分のメインステップ終了時』",
      "自分の手札/手元にある黄1色のカード1枚と、トラッシュにある黄の導界者ネクサスカードか、系統：「幻想」と「導魔」/「動玩」を持つスピリットカード/ネクサスカード1枚を入れ替えられる。",
    ],
    keywordTags: ["double_sided", "enter_field_core_placement_forbidden"],
    tribe: "創界石・幻想・導魔",
    image: "images/BSTH02.7-TR03(A).webp",
    rarity: "TR",
    pack: "BSTH02.7 夢違科学世紀",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【解封】[0,1]（アリス邸 or 導魔/動玩スピリットの召喚/転醒）+ 転醒 [3,4]
    // （コア3個以上・カウント9以下・全コアボイド・転醒後ブレイヴ合体可・
    // この転醒で解封不可）は grandstoneData + エンジン基盤で表現する。
    // 創界石本体ルール（対象/コア配置制限）は本文に印字されないがタイプ固有として適用される。
    grandstoneData: {
      unsealConditions: [
        {
          events: ["summon", "rebirth"],
          cardFilter: { nameContains: ["アリス邸"] },
        },
        {
          events: ["summon", "rebirth"],
          cardFilter: { tribes: ["導魔", "動玩"], categories: ["spirit"] },
        },
      ],
      rebirthCoreThreshold: 3,
      rebirthMaxCount: 9,
      rebirthRetainCores: 0,
      postRebirth: "combine_with_own_spirit",
      rebirthExcludedFromUnseal: true,
    },
    effects: [
      // 【神秘】Lv1『自分のメインステップ終了時』(engine-atomic-hand-trash-swap-legal-action):
      // 自分の手札/手元の黄1色カード1枚と、トラッシュの黄の導界者ネクサスカードか
      // 系統「幻想」&「導魔」/「動玩」のスピリット/ネクサスカード1枚を入れ替えられる。
      // condition の cards_in_zone で両側に候補が1体以上あるときだけ発火し
      // (2択とも成立しなければ発火自体させない)、queue_hand_trash_swap が
      // pendingHandTrashSwapChoice を立てる。実際の入替/辞退は
      // swap_hand_trash / decline_hand_trash_swap legal action で解決する。
      {
        timing: {
          kind: "phase",
          step: "main",
          whose: "self",
          subPhase: "end",
        },
        executionMode: "optional",
        condition: [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: ["hand", "set_aside"],
            filter: { colorCount: "mono", colors: ["yellow"] },
            min: 1,
          },
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "trash",
            filter: {
              filterOr: [
                { colors: ["yellow"], tribes: ["導界者"], category: ["nexus"] },
                {
                  tribesRequired: ["幻想"],
                  tribes: ["導魔", "動玩"],
                  category: ["spirit", "nexus"],
                },
              ],
            },
            min: 1,
          },
        ],
        steps: [
          {
            action: {
              kind: "queue_hand_trash_swap",
              outgoingFilter: { colorCount: "mono", colors: ["yellow"] },
              incomingFilter: {
                filterOr: [
                  {
                    colors: ["yellow"],
                    tribes: ["導界者"],
                    category: ["nexus"],
                  },
                  {
                    tribesRequired: ["幻想"],
                    tribes: ["導魔", "動玩"],
                    category: ["spirit", "nexus"],
                  },
                ],
              },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "操り糸",
      printedCategory: "brave",
      colors: ["yellow"],
      cost: 4,
      reductionSymbols: [],
      // Lv1 コスト（必要コア）は 0 が正（ユーザー裁定 2026-06-10: 旧データの 1 は誤記）。
      // 転醒で全コアボイド（retainCores 0）後、合体しなくても 0 コアで存続する。
      levelDefs: [
        {
          level: 1,
          requiredCores: 0,
          bp: 1000,
        },
      ],
      symbolColors: ["yellow"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。",
        "",
        "Lv1『このブレイヴの転醒時』",
        "自分のトラッシュにある系統：「動玩」を持つコスト6以下のスピリットカード1枚をコスト0として召喚できる。",
        "",
        "【合体条件：黄＆導魔/動玩】",
        "",
        "【合体中】『このスピリットのアタック時』",
        "アタックしているこのスピリットにとってこのブレイヴのコストを0にする。自分のライフのコア1個をこのスピリットに置くことで、このスピリットは回復する。",
      ],
      keywordTags: [],
      tribe: "導魔・動玩",
      // 【合体条件：黄＆導魔/動玩】（色 AND 系統OR）
      braveCondition: { colors: ["yellow"], tribes: ["導魔", "動玩"] },
      image: "images/BSTH02.7-TR03(B).webp",
      rarity: "TR",
      pack: "BSTH02.7 夢違科学世紀",
      cardNo: "BSTH02.7-TR03(B)",
      combinedBoost: 6000,
      effects: [
        {
          timing: { kind: "card_event", event: "rebirth" },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "summon",
                target: {
                  kind: "from_zone",
                  zone: "trash",
                  filter: {
                    category: ["spirit"],
                    tribes: ["動玩"],
                    maxCost: 6,
                  },
                  count: 1,
                },
                costModifier: { override: 0 },
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { combined: true },
          steps: [
            {
              action: {
                kind: "override_properties",
                // 合体コストに加算する「このブレイヴ」のコストだけを0にする。
                // 合体先自身のコストは上書きせず、バトルの間だけ適用する。
                target: { kind: "source_card" },
                properties: { cost: 0 },
                duration: { scope: "battle" },
              },
            },
          ],
          textRef: [7, 8],
        },
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { combined: true },
          executionMode: "optional",
          steps: [
            {
              id: "life-core-to-host",
              action: {
                kind: "core_move",
                from: { kind: "life", player: "self" },
                // 合体中の「このスピリット」はブレイヴ自身でなく合体先 host を指す。
                target: { kind: "self" },
                to: { kind: "target_card" },
                amount: 1,
              },
            },
            {
              connector: "conditional_cost",
              action: { kind: "recover", target: { kind: "self" } },
            },
          ],
          textRef: [7, 8],
        },
      ],
    },
  },
  {
    cardNo: "BSTH02.7-TX01(A)",
    orikaId: 471,
    orikaIndex: 102,
    name: "「グランギニョル座の怪人」",
    printedCategory: "magic",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["six"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回:同名〕手札にあるこのカードは、相手によって自分のライフが減ったとき、相手のスピリット/アルティメット1体を手札に戻せる。戻したとき、この効果発揮後、このカードの【転醒】を発揮できる。",
      "",
      "【転醒：自分のカウント9以下（転醒は同時に使えない）】",
      "3コスト支払うことで、このカードを裏返し、このバトル終了時、アタックステップを終了する。このとき、トラッシュの《ソウルコア》以外のコア1個までとフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置く。",
      "",
      "フラッシュ",
      "このバトルの間、自分のライフは減らない。",
    ],
    keywordTags: ["rebirth", "double_sided"],
    image: "images/BSTH02.7-TX01(A).webp",
    rarity: "TX",
    pack: "BSTH02.7 夢違科学世紀",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // 「手札にあるこのカードは、相手によって自分のライフが減ったとき」= applicability.zone:"hand"
        // + game_event(player:"self", event:"reduce_life", cause:["opponent_effect","battle"])。
        // 先例: BSDB01-M02 effects[2] (BSDB01.ts:1236-1249, applicability.zone:"hand" +
        // game_event + triggerFilter + cause + usageLimit per_card_name + executionMode optional)。
        // 「相手によって」cause の SSOT は structured-effect-registrations.mapBurstTriggerToCause。
        timing: {
          kind: "game_event",
          player: "self",
          event: "reduce_life",
          cause: ["opponent_effect", "battle"],
        },
        applicability: { zone: "hand" },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        executionMode: "optional",
        steps: [
          {
            id: "bounce",
            action: {
              kind: "bounce",
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
          // 「戻したとき、この効果発揮後、このカードの【転醒】を発揮できる」
          // (ENGINE-magic-rebirth-from-hand)。bounce 成功をゲートに after_triggers で
          // 3コスト支払い → conditional_cost で【転醒】(maxCount:9) を発揮。転醒本体
          // (手札/手元→フィールド配置＋Lv別必要コア初期化) は executeRebirth が
          // 手札/手元ゾーンを検出して executeMagicRebirthFromHand へ委譲する
          // (structured-card-replacement.ts)。
          {
            id: "rebirth_pay",
            connector: "after_triggers",
            stepCondition: { kind: "ref_succeeded", stepId: "bounce" },
            executionMode: "optional",
            action: { kind: "pay_cost", amount: 3 },
          },
          {
            id: "rebirth",
            connector: "conditional_cost",
            action: {
              kind: "rebirth",
              maxCount: 9,
              allowPostRebirthCorePlacementForLvDeficit: true,
            },
          },
          // トラッシュの《ソウルコア》以外のコア1個まで + フィールド/リザーブのコアを
          // 好きなだけ。1つの core placement HUD に source としてまとめる。
          // conditional_cost 失敗で rebirth が skip された rollback state 経由でここまで
          // 到達しても発火しないよう、end_attack_step と同じ on_field ゲートを重ねる。
          {
            connector: "sequential",
            condition: [{ kind: "self_state", state: "on_field" }],
            action: {
              kind: "core_distribute",
              from: {
                kind: "field_reserve_and_trash_self",
                trashCoreLimit: 1,
                trashCoreKind: "normal_only",
              },
              to: { kind: "source_card" },
              amount: "all",
              mode: "player_choice",
              minTotal: 1,
            },
          },
          // 「このバトル終了時、アタックステップを終了する」。deferTo:"battle_end"
          // (M13「大妖精」パターン、step-defer-battle-end.test.ts)。
          // コア配置は転醒の「このとき」なので、この遅延 step より前に処理する。
          // ゲートは stepCondition:ref_succeeded ではなく state-based な
          // condition:self_state(on_field) を使う (interceptStepBattleEndDeferral 拡張)。
          {
            connector: "sequential",
            condition: [{ kind: "self_state", state: "on_field" }],
            deferTo: "battle_end",
            action: { kind: "end_attack_step" },
          },
        ],
        textRef: [0, 2, 3],
      },
      // フラッシュ：このバトルの間、自分のライフは減らない。
      // 発生源限定なし → life_damage_interception(cause:"any", mode:"replace", duration:battle)。
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
              cause: "any",
              mode: "replace",
              duration: {
                scope: "battle",
              },
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "怪人グラン・ギニョール",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 7,
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
      ],
      symbolColors: ["yellow"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。",
        "",
        "Lv1-Lv2『このスピリットのアタック時』",
        "〔ターンに1回:同名〕自分の導界者ネクサスの「アリス・マーガトロイド」があるとき、手札/手元のコスト6以下のマジックカード1枚のフラッシュ効果を1コスト支払ってただちに使用できる。",
        "",
        "Lv2『相手のアタックステップ開始時』",
        "相手のスピリット/アルティメット1体をデッキの下に戻せる。その後、手札/手元にあるバースト効果を持つカード1枚をセットできる。",
      ],
      keywordTags: ["burst"],
      tribe: "起幻・幻想・動玩",
      image: "images/BSTH02.7-TX01(B).webp",
      rarity: "TX",
      pack: "BSTH02.7 夢違科学世紀",
      cardNo: "BSTH02.7-TX01(B)",
      effects: [
        // Lv1-Lv2『このスピリットのアタック時』〔ターンに1回:同名〕自分の導界者ネクサスの
        // 「アリス・マーガトロイド」があるとき、手札/手元のコスト6以下のマジックカード1枚の
        // フラッシュ効果を1コスト支払ってただちに使用できる。
        // - 「使用」したマジックは in_use を経由して解決後にトラッシュへ置かれる
        //   (10_rules/01_glossary-and-card-types.md:9-11)。treatAsMagicUse が通常の
        //   マジック使用 dispatch（使用前反応窓・標準 cleanup を含む）へ接続する。
        // - 固定の「1コスト支払って」は借用先カード本来のコストではないため、pay_cost(1) と
        //   conditional_cost を使う (BSAZ01-CX01 effects[2] の同型)。
        // - 「使用できる」は任意なので effect-level executionMode:"optional"。実行すると決めた
        //   後の支払いと借用は一体の手順であり、step-level optional は重ねない
        //   (10_rules/03c_effect-text-interpretation.md:12-17)。
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { level: { min: 1, max: 2 } },
          usageLimit: { kind: "per_card_name", duration: "turn" },
          executionMode: "optional",
          condition: [
            {
              kind: "field_has",
              player: "self",
              category: ["nexus"],
              tribes: ["導界者"],
              cardNames: [{ contains: "アリス・マーガトロイド" }],
            },
          ],
          steps: [
            { id: "cost", action: { kind: "pay_cost", amount: 1 } },
            {
              connector: "conditional_cost",
              action: {
                kind: "borrow_magic_effect",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: ["hand", "set_aside"],
                  filter: {
                    category: ["magic"],
                    maxCost: 6,
                    hasActivatedEffectMode: ["flash"],
                  },
                  count: 1,
                },
                borrowModes: ["flash"],
                treatAsMagicUse: true,
              },
            },
          ],
          textRef: [2, 3],
        },
        {
          timing: {
            kind: "phase",
            step: "attack",
            whose: "opponent",
            subPhase: "start",
          },
          applicability: { level: { min: 2 } },
          executionMode: "optional",
          steps: [
            {
              executionMode: "optional",
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
            // 「その後」は前段の成否に依存しない（10_rules/03c）。
            {
              connector: "sequential",
              executionMode: "optional",
              action: {
                kind: "set_burst",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: ["hand", "set_aside"],
                  filter: { hasBurstEffect: true },
                  count: 1,
                },
              },
            },
          ],
          textRef: [5, 6],
        },
      ],
    },
  },
  {
    cardNo: "BSTH02.7-X01",
    orikaId: 473,
    orikaIndex: 103,
    name: "ゴリアテ人形",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 8,
    reductionSymbols: ["yellow", "yellow", "yellow", "yellow", "yellow"],
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
        bp: 18000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "〔重複不可〕手札/手元にあるこのカードは、自分の「アリス邸」か系統：「動玩」/「導魔」を持つスピリットが、転醒したか、相手によってフィールドを離れたとき、相手のスピリット/アルティメット1体をデッキの下に戻すことができ、1コスト支払って召喚できる。",
      "",
      "Lv1-Lv2-Lv3『自分のアタックステップ』",
      "相手がスタック効果を発揮したとき、このスピリットの『このスピリットのアタック時』効果をLvと〔ターンに1回:同名〕を無視して発揮できる。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "〔ターンに1回:同名〕自分のカウント1以上のとき、手札/手元/トラッシュの系統：「動玩」を持つカード2枚までをコストを支払わずに召喚できる。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・動玩",
    image: "images/BSTH02.7-X01.webp",
    rarity: "X",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] 手札/手元のこのカードは、自分の「アリス邸」か系統:「動玩」/「導魔」を持つ
      //   スピリットが転醒したか、相手によってフィールドを離れたときに誘発する。
      //   rebirth (cause概念を持たない) と leave_field(cause:opponent_effect) は
      //   異なる event family (state_change / leave_field) かつ異なる cause 要件のため、
      //   単一 timing.event 配列+共通 cause では表現できない (cause は配列内の全 event に
      //   一律適用され、rebirth 側が fail-closed で死ぬ)。2つの effect に分割する。
      //   precedent: 同ファイル BSTH02.7-TR03(A) grandstoneData.unsealConditions が同じ
      //   「アリス邸」or「導魔/動玩スピリット」の名前/系統 filterOr 分岐を持つ。
      //   デッキ下送りと1コスト召喚は「〜ことができ、〜できる」= 独立した2つの任意行動
      //   (step.executionMode:"optional" を2 step それぞれに付け、2番目に
      //   connector:"simultaneous" — step-execution-mode-optional.test.ts の
      //   「1枚引く。さらに、1枚引ける。」パターンと同型で、1つ目の実行可否が2つ目に影響しない)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "rebirth",
          triggerFilter: {
            filterOr: [
              { cardName: [{ contains: "アリス邸" }] },
              {
                category: ["spirit"],
                tribes: ["導魔", "動玩"],
                tribesLogic: "or",
              },
            ],
          },
        },
        applicability: { zone: ["hand", "set_aside"] },
        executionMode: "optional",
        usageLimit: {
          kind: "no_duplicate",
        },
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
            executionMode: "optional",
            connector: "simultaneous",
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: { fixedPayment: 1 },
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          exactEventKind: true,
          triggerFilter: {
            filterOr: [
              { cardName: [{ contains: "アリス邸" }] },
              {
                category: ["spirit"],
                tribes: ["導魔", "動玩"],
                tribesLogic: "or",
              },
            ],
          },
          // 「相手によって」= cause:["opponent_effect","battle"]（BSTH02.ts:1583-1584 SSOT規約:
          // 「相手によって」は広義(バトル込み)、「相手の効果で」は cause:"opponent_effect" 単独）。
          cause: ["opponent_effect", "battle"],
        },
        applicability: { zone: ["hand", "set_aside"] },
        executionMode: "optional",
        usageLimit: {
          kind: "no_duplicate",
        },
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
            executionMode: "optional",
            connector: "simultaneous",
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: { fixedPayment: 1 },
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] Lv1-Lv2-Lv3『自分のアタックステップ』相手がスタック効果を発揮したとき、
      //   このスピリットの『このスピリットのアタック時』効果(下記[5,6])をLvと
      //   〔ターンに1回:同名〕を無視して発揮できる。ENGINE-stack-activation-reactivation-trigger
      //   (timing.event:"stack", magic-system.ts resolveDeferredMagicStack 完全解決後発火) +
      //   BSSA01-C04型 reactivation pattern ([5,6] steps を複製、applicability/usageLimit省略で
      //   Lv/回数制限を無視)。カウント1以上条件のみ残す(「Lvと〔ターンに1回:同名〕を無視」と
      //   明記されており、カウント条件は無視対象に含まれない)。
      {
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "stack",
        },
        condition: [
          { kind: "step_phase", step: "attack", whose: "self" },
          { kind: "count_value", player: "self", min: 1 },
        ],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["動玩"],
                },
                count: { min: 0, max: 2 },
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [2, 3],
      },
      // [5,6] Lv2-Lv3『アタック時』〔ターンに1回:同名〕カウント1以上のとき、
      //   手札/手元/トラッシュの系統:「動玩」カード2枚までを無コスト召喚。
      // pattern: BSSA01-X02 effects[1] 同型 (zone:[hand,set_aside]+tribes+costModifier:"free"+
      // count:{min:0,max:2}+executionMode:"optional")。動玩は本弾でトラッシュ込みの源を持つため
      // zone:[hand,set_aside,trash] へ 1 ゾーン拡張する。
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [
          { kind: "min_level", value: 2 },
          { kind: "count_value", player: "self", min: 1 },
        ],
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  tribes: ["動玩"],
                },
                count: { min: 0, max: 2 },
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
    cardNo: "BSTH02.7-X02",
    orikaId: 474,
    orikaIndex: 104,
    name: "上海人形",
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
        requiredCores: 2,
        bp: 10000,
      },
      {
        level: 3,
        requiredCores: 3,
        bp: 15000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1 フラッシュ『相手のアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。このとき、自分のトラッシュにある系統：「幻想」/「導界者」/「導魔」/「動玩」を持つ黄1色のカード4枚までを除外し、除外したカード1枚につき、コストを-1する。自分のライフが3以下のとき、この「除外効果」は相手の効果では防げない。召喚したとき、このターンの間、相手のスピリット/アルティメット3体はアタックできない。。",
      "",
      "Lv2-Lv3『このスピリットのアタック/ブロック時』",
      "ターンに1回、ボイド/自分の導界者ネクサスのコア1個を自分のライフに置ける。そうしたとき、自分のデッキを2枚破棄する。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・動玩",
    image: "images/BSTH02.7-X02.webp",
    rarity: "X",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1 フラッシュ『相手のアタックステップ』手札/手元から召喚可能。
      // Q54 の通常行動許可ではなく、use_hand_card_effect の宣言窓後に除外コストと
      // summon target:self を解決する即時効果。
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: {
          kind: "activated",
          mode: "flash",
        },
        timingScope: { player: "opponent", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [0, 1],
      },
      // 「このとき、トラッシュの黄1色幻想/導界者/導魔/動玩カード4枚まで除外、1枚につき
      // コスト-1」= BSTH02.7-M01 effects[0] と同一 primitive (cost_modify +
      // useCostPayment.kind:"exclude")。即時効果本体とは別の continuous effect に支払い方法を
      // 記述し、効果解決中の self summon が getSummonCostExcludeChoiceOption で参照する。
      // 「自分のライフが3以下のとき、この『除外効果』は相手の効果では防げない」=
      // preventionLevelCondition 付き effect-level preventionLevel（BSDB01-X02 同型）。
      {
        timing: {
          kind: "continuous",
        },
        preventionLevel: "unpreventable",
        preventionLevelCondition: [
          { kind: "life_value", player: "self", max: 3 },
        ],
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: { kind: "self" },
              modifier: { additionalCostValue: -1 },
              useCostPayment: {
                kind: "exclude",
                sourceZone: "trash",
                maxCount: 4,
                effectSummonEffectIndex: 0,
                filter: {
                  tribes: ["幻想", "導界者", "導魔", "動玩"],
                  colors: ["yellow"],
                  colorCount: "mono",
                },
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // 「召喚したとき、このターンの間、相手のスピリット/アルティメット3体はアタックできない」
      {
        timing: { kind: "card_event", event: ["summon"], sourceEffectIndex: 0 },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: 3,
              },
              restriction: ["attack"],
              duration: {
                scope: "turn",
              },
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-Lv3『このスピリットのアタック/ブロック時』ターンに1回:
      //   「ボイド/自分の導界者ネクサスのコア1個を自分のライフに置ける。そうしたとき、
      //    自分のデッキを2枚破棄する。」
      // event:["attack","block"] でアタック/ブロック両方を 1 effect に統合し、
      //   usageLimit:per_instance:turn が attack/block 跨ぎでも共有される
      //   ([[project_attack_time_scope_immediate]] と多重 event の標準パターン同型: BSKB01/BSSG01)。
      // 「そうしたとき」= 前段 core_move が実 commit したときのみ後段を実行 → connector:"conditional_result"
      //   (正源: BSTH02.7-TR02(A) [3,4] = bsth02-7-tr02-deck-trash-core-to-life.test.ts)。
      // 「ボイド/自分の導界者ネクサスのコア」の多源選択は choice (choiceIndex 0=void既定 /
      //   1=field_card 導界者ネクサス) で表現する (BSTH02.7-C02 effects[0] 同型 choice+optional
      //   パターン)。導界者ネクサス filter は BSTH02.7-X03 effects[1] "guide_core" step と同型
      //   (category:nexus + targetsGrandwalker + hasMechanic:["guided"]、名前限定なし)。
      {
        timing: {
          kind: "card_event",
          event: ["attack", "block"],
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
            action: {
              kind: "core_move",
              from: {
                kind: "union",
                sources: [
                  { kind: "void", player: "self" },
                  {
                    kind: "field_card",
                    player: "self",
                    filter: {
                      category: ["nexus"],
                      targetsGrandwalker: true,
                      hasMechanic: ["guided"],
                    },
                  },
                ],
              },
              to: { kind: "life", player: "self" },
              amount: 1,
            },
          },
          {
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "trash" },
              count: 2,
              deckDiscard: true,
            },
            connector: "conditional_result",
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH02.7-X03",
    orikaId: 475,
    orikaIndex: 105,
    name: "蓬莱人形",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 8,
    reductionSymbols: ["yellow", "yellow", "yellow", "yellow", "guide"],
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
        bp: 15000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "フラッシュ【顕現：「アリス」&導界者ネクサス&C2以上『自分のメインステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象から1コスト支払って手札から召喚する。",
      "",
      "Lv1-Lv2-Lv3【界放：1】『このスピリットの召喚/アタック時』",
      "〔ターンに1回:同名〕このターンの間、相手のスピリット/アルティメット1体をBP-10000できる。この効果を自分のカウントの数まで追加で発揮し、BPが0になった対象を破壊できる。自分の導界者ネクサスのコア1個をこのスピリットに置ける。そうしたとき、破壊した対象の効果を発揮させない。",
      "",
      "Lv2-Lv3『このスピリットの召喚/アタック時』",
      "ターンに1回、ボイドからコア1個を自分のライフに置ける。",
      "",
      "Lv3『自分のアタックステップ』",
      "自分の効果で自分のライフが増えるとき、増やすかわりに相手のライフのコア1個をトラッシュに置ける。",
    ],
    keywordTags: [],
    tribe: "起幻・幻想・動玩",
    image: "images/BSTH02.7-X03.webp",
    rarity: "X",
    pack: "BSTH02.7 夢違科学世紀",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【顕現：「アリス」&導界者ネクサス&C2以上『自分のメインステップ』】。
    // 顕現は CardDefinition.manifestData で宣言する（advent と同じく effects[] には対応
    // エントリを置かない。BSDB01-C01 の adventData 前例と同型。ENGINE-manifest-declaration
    // -mechanic）。公式エターナル版キーワード効果「顕現」(battlespirits.com ルールマニュアル
    // §特殊な効果): 自分のソウルコアをトラッシュに置き、対象（創界神グランウォーカーネクサス
    // 相当）のコア1個で召喚コストを1コスト支払う（=合計支払いはこの1個のみ）ことで手札から
    // 召喚する。「アリス」&導界者ネクサスは同一対象が満たすべき条件。
    // targetFilter は本カード effects[0] "guide_core" step と同じ
    // category:nexus+targetsGrandwalker+hasMechanic:["guided"] フィルタを再利用し、
    // C2以上は自分のカウント条件であり、対象のコア数条件ではない（公式エターナルQ28184）。
    // cardName:「アリス」(部分一致) を追加する (SSOT:
    // matchesCardFilter、専用 ManifestCondition 評価器は導入しない)。
    manifestData: {
      targetFilter: {
        category: ["nexus"],
        targetsGrandwalker: true,
        hasMechanic: ["guided"],
        cardName: { contains: "アリス" },
      },
      condition: [{ kind: "count_value", player: "self", min: 2 }],
      manifestTiming: "own_main_step",
      soulCoreDest: "trash",
    },
    effects: [
      // 【界放：1】『召喚/アタック時』〔ターンに1回:同名〕相手1体を BP-10000。
      // 召喚・アタックを単一 effect の event 配列で表現し per_card_name を共有する
      // （別 effect だと「ターンに1回」が summon/attack で各1回使えてしまう）。
      // BP-10000 は本体を実行した場合、カウント数まで追加発揮する。破壊後に導界者コアを置いた場合は、
      // flush 前の pending leave に破壊時効果抑止を付与する。
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            id: "bp0",
            executionMode: "optional",
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
              amount: -10000,
              duration: {
                scope: "turn",
              },
            },
            repeat: {
              optional: true,
              additional: {
                source: { kind: "count_value", player: "self" },
              },
            },
          },
          {
            id: "destroy_bp0",
            action: {
              kind: "destroy",
              target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
            },
            executionMode: "optional",
            stepCondition: {
              kind: "ref_count",
              stepId: "bp0",
              result: "bp_became_zero",
              min: 1,
            },
            connector: "simultaneous",
          },
          {
            id: "guide_core",
            action: {
              kind: "core_move",
              from: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  targetsGrandwalker: true,
                  hasMechanic: ["guided"],
                },
              },
              to: { kind: "this_card" },
              amount: 1,
            },
            executionMode: "optional",
            connector: "simultaneous",
          },
          {
            action: {
              kind: "suppress_pending_leave_effects",
              target: { kind: "ref", stepId: "destroy_bp0" },
              suppressDestroyedEffects: "destroyed_only",
            },
            stepCondition: { kind: "ref_succeeded", stepId: "guide_core" },
            connector: "simultaneous",
          },
        ],
        textRef: [3, 4],
      },
      // Lv2-Lv3『召喚/アタック時』ターンに1回、ボイドからコア1個を自分のライフへ。
      // 召喚・アタックを単一 effect の event 配列で表現し per_instance を共有する
      // （別 effect だと「ターンに1回」が summon/attack で各1回使えてしまう）。
      {
        timing: {
          kind: "card_event",
          event: ["summon", "attack"],
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
      // 自分のアタックステップ中、自分の効果で自分のライフが増えるとき、増やす代わりに
      // 相手のライフのコア1個をトラッシュに置ける。置換効果。
      // life_gain_replacement CE (BSTH02.7-C02 effects[1] の timingScope:{player:"self",
      // period:"attack"} 先例と同型) を登録し、executeCoreMove の to:life 自己増加経路が
      // pendingLifeGainReplacementChoice を立てて replace/decline を解決する。
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
              kind: "life_gain_replacement",
              player: "self",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
];
