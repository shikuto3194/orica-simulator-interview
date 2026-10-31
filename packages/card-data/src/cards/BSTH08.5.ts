import type { CardDefinition } from "@orica/rules-core";

export const BSTH08_5_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH08.5-C20",
    combinedBoost: 4000,
    orikaId: 221,
    orikaIndex: 230,
    name: "能面・女（平静）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■手元にある系統：「面霊」を持つブレイヴカードすべてのシンボルは、フィールドにあるものとしても扱う。",
      "",
      "メイン【アクセル：コスト3<赤>（この効果は手札から使用できる）】",
      "自分のデッキを上から4枚オープンする。その中の系統：「面霊」を持つ創界神ネクサスカード1枚と、系統：「面霊」を持つスピリットカード1枚と、系統：「面霊」を持つブレイヴカード2枚までを手札に加える。残ったカードは破棄する。",
      "",
      "【合体条件：面霊＆コスト6以上】",
    ],
    keywordTags: ["accel"],
    tribe: "面霊",
    image: "images/BSTH08.5-C20.webp",
    rarity: "C",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    accelData: {
      timing: "main",
      cost: 3,
      reduction: ["red"],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 4,
                picks: [
                  {
                    count: 1,
                    filter: {
                      category: ["nexus"],
                      tribes: ["面霊"],
                      targetsGrandwalker: "only",
                    },
                    mandatory: true,
                  },
                  {
                    count: 1,
                    filter: { category: ["spirit"], tribes: ["面霊"] },
                    mandatory: true,
                  },
                  {
                    count: 2,
                    filter: { category: ["brave"], tribes: ["面霊"] },
                  },
                ],
                remainder: "trash",
              },
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
    effects: [
      // 手元にあるこのカードの常駐効果（面霊ブレイヴのシンボルをフィールド扱い）。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "extend_field_symbol_source",
              player: "self",
              zone: "set_aside",
              filter: { category: ["brave"], tribes: ["面霊"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-C21",
    combinedBoost: 4000,
    orikaId: 222,
    orikaIndex: 231,
    name: "能面・大飛出（驚）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■お互いのデッキは破棄されない。",
      "■BP6000以下のスピリット/アルティメットのアタックでは、自分のライフは1ターンに2以上減らない。",
      "",
      "メイン【アクセル：コスト3<赤><赤>（この効果は手札から使用できる）】",
      "自分はデッキから3枚ドローする。その後、手札にあるカードすべてまたは系統：「面霊」を持つカード1枚を破棄する。",
      "",
      "【合体条件：面霊＆コスト6以上】",
    ],
    keywordTags: [],
    tribe: "面霊",
    image: "images/BSTH08.5-C21.webp",
    rarity: "C",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    effects: [
      // 手元常駐: BP6000以下のアタックでは自分ライフが1ターンに2以上減らない。
      // = per-attacker-BP gate cap（attackerFilter:{maxBp:6000} + attackerBpTurnCap:1）。
      // 「2以上減らない」= 減少は最大1（cap=N=1）。基底 turn_cap と独立トラックで、
      // BP>6000 や非バトル由来は枠外で無制限（10_rules/05、裁定2026-06-16）。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          // ■お互いのデッキは破棄されない。= prevent_deck_discard("either")。
          // 真に「デッキを破棄する」と記す効果を原因不問で両プレイヤー分止める。
          // 単なるデッキ→トラッシュ配置は Q3900 により別の移動として扱う。
          {
            action: {
              kind: "prevent_deck_discard",
              player: "either",
              duration: { scope: "while_in_set_aside" },
            },
          },
          // ■BP6000以下のスピリット/アルティメットのアタックでは、自分のライフは1ターンに2以上
          //   減らない。= per-attacker-BP gate cap（attackerFilter:{maxBp:6000}+attackerBpTurnCap:1）。
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "any",
              mode: "replace",
              attackerFilter: {
                maxBp: 6000,
                category: ["spirit", "ultimate"],
              },
              attackerBpTurnCap: 1,
              duration: { scope: "while_in_set_aside" },
            },
          },
        ],
        textRef: [0, 1, 2],
      },
      // メイン【アクセル：コスト3<赤><赤>】3ドロー→手札すべて or 面霊1枚を破棄。
    ],
    accelData: {
      timing: "main",
      cost: 3,
      reduction: ["red", "red"],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            { action: { kind: "draw", count: 3 } },
            {
              targetSelectionTiming: "on_step",
              label: "手札すべてを破棄",
              connector: "sequential",
              action: { kind: "discard", count: "all", player: "self" },
              choice: [
                {
                  label: "面霊1枚を破棄",
                  action: {
                    kind: "discard",
                    count: 1,
                    player: "self",
                    filter: { tribes: ["面霊"] },
                  },
                },
              ],
            },
          ],
          textRef: [4, 5],
        },
      ],
    },
  },
  {
    cardNo: "BSTH08.5-C22",
    combinedBoost: 4000,
    orikaId: 223,
    orikaIndex: 232,
    name: "能面・猿（困）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■お互いコストを支払わずに手札/手元のカードを使えない。",
      "",
      "フラッシュ【アクセル：コスト4<赤><赤>（この効果は手札から使用できる）】",
      "このバトル終了時、アタックステップを終了する。相手の効果を受けたとき、この効果をもう一度だけ発揮できる。",
      "",
      "【合体条件：面霊＆コスト6以上】",
      "【合体中】『このスピリットのアタック時』",
      "このスピリットはブロックされない。この効果はターンに1回しか使えない。",
    ],
    keywordTags: ["accel"],
    tribe: "面霊",
    image: "images/BSTH08.5-C22.webp",
    rarity: "C",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    accelData: {
      timing: "flash",
      cost: 4,
      reduction: ["red", "red"],
      effects: [
        // 「相手の効果を受けたとき、この効果をもう一度だけ発揮できる」= 裁定確定済み
        // (needs-ruling.jsonl BSTH08.5-C22、狭い読み採用): 1回目の end_attack_step が
        // 相手の一時的(即時系)妨害で不成立だったときのみ、その場でもう一度だけ試みる。
        // StepCondition.ref_succeeded(not:true) で1つ目 step の失敗をゲートに使う
        // (既存プリミティブのみ、新規エンジン拡張不要)。継続系妨害(restrict_end_attack_step
        // 等のCE)は2回目も同様に阻まれる想定で、これは設計上の既知の限界として受け入れる。
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              id: "end-attack-step",
              deferTo: "battle_end",
              action: { kind: "end_attack_step" },
            },
            {
              id: "retry-end-attack-step",
              executionMode: "optional",
              stepCondition: {
                kind: "ref_blocked_by_opponent_effect",
                stepId: "end-attack-step",
              },
              action: { kind: "end_attack_step" },
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
    effects: [
      // 手元常駐: お互いコストを支払わずに手札/手元のカードを使えない
      // = restrict_use(player:self/opponent, filter:{zone:[hand,set_aside], maxCost:0})。
      // 「お互い」= 人称参照のため BSTH04-X02 と同型で self/opponent 2 step + simultaneous
      // (project_player_target_vs_card_target)。duration は set_aside 常駐と同型で permanent
      // (applicability:{zone:"set_aside"} 側で再評価、BSTH08.5-C23 effects[0] 前例)。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "restrict_use",
              player: "self",
              filter: { zone: ["hand", "set_aside"], maxCost: 0 },
              duration: { scope: "permanent" },
            },
          },
          {
            action: {
              kind: "restrict_use",
              player: "opponent",
              filter: { zone: ["hand", "set_aside"], maxCost: 0 },
              duration: { scope: "permanent" },
            },
            connector: "simultaneous",
          },
        ],
        textRef: [0, 1],
      },
      // 【合体中】『このスピリットのアタック時』ブロックされない。ターンに1回。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          {
            action: {
              kind: "unblockable",
              target: { kind: "self" },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-C23",
    combinedBoost: 4000,
    orikaId: 224,
    orikaIndex: 233,
    name: "能面・火男（楽）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■相手の効果によって自分のライフが減るとき、このカードを破棄することで、自分のライフは減らない。",
      "",
      "メイン【アクセル：コスト4<赤><赤>（この効果は手札から使用できる）】",
      "自分のデッキを上から5枚オープンする。その中の系統：「面霊」を持つ創界神ネクサスカードすべてか、1コスト支払うことで、系統：「面霊」を持つスピリットカード/ブレイヴカード合計3枚を手札に加えるまたは手元に置く。残ったカードは破棄する。",
      "",
      "【合体条件：面霊＆コスト6以上】",
    ],
    keywordTags: ["accel"],
    tribe: "面霊",
    image: "images/BSTH08.5-C23.webp",
    rarity: "C",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    // メイン【アクセル：コスト4<赤><赤>（この効果は手札から使用できる）】(textLines[3,4])
    // デッキ5オープン→(A)面霊創界神ネクサスすべてを無償で得る か (B)1コスト支払いで
    // 面霊スピ/ブレイヴ合計3枚を得る、の排他二択(exclusiveGroup XOR、BSTH08.5-X03型)。
    // (B) は costGate:1 (本 cluster で新設、deck-reveal-cost-gated-destination-choice)。
    // getDeckRevealExclusiveGroupBranches が支払い不能時に候補0枚化し (A) 側へフォールバック
    // する。得たカードの行き先「手札に加えるまたは手元に置く」は交換を伴わない自由選択のため
    // destination:"hand_or_set_aside_choice" (同cluster新設) で表現し、
    // ApplyLegalActionOptions.deckRevealPickFreeDestination で選択確定時に解決する
    // (BSTH09-C04/C05 hand_or_set_aside_swap と異なり交換相手が不要なため、別 pending を
    // 起こさず同一 resolve_pending_deck_reveal_pick アクションの追加入力で完結する)。
    // C24 (BSTH08.5-C24) と同じく、accelData.effects[] 側にのみ効果を持たせ
    // 外側 effects[] には重複させない (accelData 適用で二重発火するため)。
    accelData: {
      timing: "main",
      cost: 4,
      reduction: ["red", "red"],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "deck_reveal",
                revealCount: 5,
                picks: [
                  {
                    count: -1,
                    filter: {
                      category: ["nexus"],
                      targetsGrandwalker: "only",
                      tribes: ["面霊"],
                    },
                    mandatory: true,
                    exclusiveGroup: "nexus_free_or_paid_spirit_brave",
                    destination: "hand_or_set_aside_choice",
                  },
                  {
                    count: 3,
                    filter: {
                      category: ["spirit", "brave"],
                      tribes: ["面霊"],
                    },
                    mandatory: true,
                    exclusiveGroup: "nexus_free_or_paid_spirit_brave",
                    costGate: 1,
                    destination: "hand_or_set_aside_choice",
                  },
                ],
                remainder: "trash",
              },
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
    effects: [
      // 手元常駐: 相手の効果によって自分のライフが減るとき、このカードを破棄することで
      // 自分のライフは減らない。= life_damage_interception(replace, cause:opponent_effect,
      // discardCostGate:{zones:[set_aside]})。BSTH02.7-C05[1] と同型（手元専用のためzoneは
      // set_aside のみ、hand無し）。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "life_damage_interception",
              player: "self",
              cause: "opponent_effect",
              mode: "replace",
              discardCostGate: { zones: ["set_aside"] },
              duration: {
                scope: "permanent",
              },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-C24",
    combinedBoost: 4000,
    orikaId: 225,
    orikaIndex: 234,
    name: "能面・姥（哀）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■系統：「面霊」を持つ自分のスピリットのコアは相手の効果によってLv1コストより少なくならない。",
      "",
      "フラッシュ【アクセル：コスト4<赤><赤>（この効果は手札から使用できる）】",
      "自分のトラッシュにある系統：「面霊」を持つカード合計3枚までを手札/手元に戻す。この効果はゲーム中に3回しか使えない。",
      "",
      "【合体条件：面霊＆コスト6以上】",
    ],
    keywordTags: ["accel"],
    tribe: "面霊",
    image: "images/BSTH08.5-C24.webp",
    rarity: "C",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    accelData: {
      timing: "flash",
      cost: 4,
      reduction: ["red", "red"],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          usageLimit: { kind: "per_card_name", duration: "game", maxCount: 3 },
          steps: [
            {
              // 戻し先「手札/手元」は各選択カードごとに独立指定できる。
              // choiceIndex では全体二択になってしまうため、zone selection の
              // per-card destination 入力を SSOT にする。
              action: {
                kind: "search_zone",
                zone: "trash",
                filter: { tribes: ["面霊"] },
                count: { min: 0, max: 3 },
                destination: "hand_or_set_aside_choice",
              },
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
    effects: [
      // 手元常駐: 面霊スピリットのコアは相手効果でLv1コスト未満にならない。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], tribes: ["面霊"] },
                count: "all",
              },
              resistsOutcome: "core_below_min",
              source: "opponent_effect",
              coreMinimumSource: { kind: "own_level_required_cores", level: 1 },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-M11",
    combinedBoost: 7000,
    orikaId: 226,
    orikaIndex: 235,
    name: "獅子（歓喜）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 5000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■自分がこのカードを除外するとき、かわりに手札に戻せる。",
      "",
      "フラッシュ【アクセル：コスト5<赤><赤><赤><神>（この効果は手札から使用できる）】",
      "相手のスピリット/アルティメット1体をデッキの下に戻す。『相手のアタックステップ』のとき、この効果は「フィールドに残る」効果以外では防げない。",
      "",
      "【合体条件：面霊＆コスト6以上】",
      "【合体中】『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体をデッキの下に戻す。さらに、相手はバーストを発動できない。",
    ],
    keywordTags: ["accel"],
    tribe: "天渡・面霊",
    image: "images/BSTH08.5-M11.webp",
    rarity: "M",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    accelData: {
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          // 使用窓は通常のフラッシュ。『相手のアタックステップ』のときだけ
          // 「防げない」になる rider は preventionLevelCondition で絞る。
          preventionLevel: "unpreventable",
          preventionLevelCondition: [
            { kind: "step_phase", step: "attack", whose: "opponent" },
          ],
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
          textRef: [3, 4],
        },
      ],
    },
    effects: [
      // 手元常駐: 自分がこのカードを除外するとき、かわりに手札に戻せる。
      // = effect_resistance(resistsOutcome:remove_from_game, source:"self",
      //   replacement:move_to(zone:"hand"))。source:"self" は「自分が除外するとき」型
      //   (ENGINE-set-aside-exit-replacement-choice)。executeRemoveFromGame の非フィールド
      //   分岐 (structured-card-replacement.ts) が一致 CE を検出すると
      //   pendingSetAsideExitReplacementChoice で「手札へ戻す/除外する」の選択を提示する。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "remove_from_game",
              source: "self",
              // while_set は burst/mirage ゾーン専用 (model.ts Duration "while_set" 定義)。
              // set_aside 常駐は applicability:{zone:"set_aside"} 側で再評価されるため
              // permanent を使う (BSTH08.5-C23 effects[0] life_damage_interception と同型、
              // adversarial verifier 2026-07-25 round2 指摘)。
              duration: { scope: "permanent" },
              replacement: { kind: "move_to", zone: "hand" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // 【合体中】『このスピリットのアタック時』相手1体をデッキ下へ。さらに相手はバーストを発動できない。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: "attack" },
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
          {
            action: {
              kind: "restrict_burst_activation",
              player: "opponent",
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-R11",
    combinedBoost: 4000,
    orikaId: 227,
    orikaIndex: 236,
    name: "能面・狐（闘）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■BP2000以下のスピリットがアタックしたとき、破壊できる。",
      "",
      "フラッシュ【アクセル：コスト5<赤><赤><赤><神>（この効果は手札から使用できる）】",
      "シンボル2つ以上の相手のスピリット/アルティメット2体を破壊する。",
      "",
      "【合体条件：面霊＆コスト6以上】",
      "【合体中】『このスピリットのアタック時』",
      "このスピリットのBP以下の相手のスピリット2体を破壊する。",
    ],
    keywordTags: ["accel"],
    tribe: "面霊",
    image: "images/BSTH08.5-R11.webp",
    rarity: "R",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    accelData: {
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
      effects: [
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
                    category: ["spirit", "ultimate"],
                    minSymbolCount: 2,
                  },
                  count: 2,
                },
              },
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
    effects: [
      // 手元常駐: BP2000以下のスピリットがアタックしたとき破壊できる。
      // 原文に「自分の」「相手の」の限定が無いため player:"either"（どちらの攻撃でも誘発）。
      // 対象は誘発元の攻撃カード自身 = trigger_related_instance（BSES01/BSTH09 前例と同型）。
      {
        applicability: { zone: "set_aside" },
        timing: {
          kind: "game_event",
          player: "either",
          event: "attack",
          triggerFilter: { category: ["spirit"], maxBp: 2000 },
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "destroy",
              target: { kind: "trigger_related_instance" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // 【合体中】『このスピリットのアタック時』このスピリットのBP以下の相手スピリット2体を破壊。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                // 「このスピリットのBP以下」= 動的 maxBp=自身の実効BP（resolveSelfBpThreshold）。
                filter: {
                  category: ["spirit"],
                  maxBpSource: "self_effective_bp",
                },
                count: 2,
              },
            },
          },
        ],
        textRef: [6, 7, 8],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-R12",
    combinedBoost: 4000,
    orikaId: 228,
    orikaIndex: 237,
    name: "能面・福の神（喜）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■このカードが手元に置かれたターンの間、自分の系統：「面霊」を持つカードの【アクセル】のコストすべてを0にできる。この効果はゲーム中に1回しか使えない。",
      "",
      "メイン【アクセル：コスト4<赤><赤>（この効果は手札から使用できる）】",
      "手札にある系統：「面霊」を持つカードを好きなだけオープンして手元に置く。その後、手元に置いたカード1枚につき自分はデッキから1枚ドローする。",
      "",
      "【合体条件：面霊＆コスト6以上】",
    ],
    keywordTags: ["accel"],
    tribe: "面霊",
    image: "images/BSTH08.5-R12.webp",
    rarity: "R",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    effects: [
      // 手元常駐: 置かれたターン、自分の面霊【アクセル】コストを0にできる。ゲーム中1回。
      // ENGINE-accel-tribe-cost-override: applicability.zone:"set_aside" + condition
      // self_state:"zone_entered_this_turn" (CardInstance.zoneEnteredAtTurn、moveCardZone が
      // ゾーン変更時にスタンプ) で「置かれたターンの間」を表現する。cost_modify
      // (player:"self", cardFilter.tribes+usingEffectMode:["accel"], modifier:"free") が
      // cost_override CE を登録し、getAccelFreeUseSource (accel-change-system.ts) が
      // getAvailableAccelLegalActions で照合する。「ゲーム中に1回」は Effect.usageLimit。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        condition: [{ kind: "self_state", state: "zone_entered_this_turn" }],
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: { tribes: ["面霊"], usingEffectMode: ["accel"] },
              modifier: "free",
            },
          },
        ],
        usageLimit: { kind: "per_card_name", duration: "game", maxCount: 1 },
        textRef: [0, 1],
      },
    ],
    // メイン【アクセル：コスト4<赤><赤>】手札の面霊を好きなだけオープンして手元へ。手元へ置いた枚数分ドロー。
    // accelData.effects[] 側にのみ効果を持たせ外側 effects[] には重複させない
    // (BSTH08.5-C24 と同型、accelData 適用で二重発火するため)。
    // ENGINE-move-card-actual-count-amount: 「手札→手元」への好きなだけ移動 (target:{kind:"filter"}
    // + count:{min:0}、既存の budget 型選択と同じ一般選択パイプライン) の実移動枚数を
    // move_card の StepResult.numericAmount に記録し (effect-interpreter.ts)、
    // 後続 draw が {kind:"step_numeric_amount"} で参照する。新規プリミティブ不要、
    // 既存 DynamicCountSource の生成箇所を move_card にも広げるだけで表現できた。
    accelData: {
      timing: "main",
      cost: 4,
      reduction: ["red", "red"],
      effects: [
        {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "r12-open-mensou",
              targetSelectionTiming: "on_step",
              action: {
                kind: "move_card",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "hand",
                  filter: { tribes: ["面霊"] },
                  count: { min: 0 },
                },
                from: {
                  zone: "hand",
                  player: "self",
                  filter: { tribes: ["面霊"] },
                },
                to: { zone: "set_aside", player: "self" },
                // target で明示選択済みのため "all" (= 選択された分すべてを移動)。
                // {min:0} 等の range は自動選択時の下限決め打ちに解決される
                // (resolveCount の "自動選択時は min を使用" 経路) ため、
                // 選択済み candidates を打ち切ってしまう (ENGINE-move-card-actual-count-amount)。
                count: "all",
              },
            },
            {
              action: {
                kind: "draw",
                count: {
                  source: {
                    kind: "step_numeric_amount",
                    stepId: "r12-open-mensou",
                  },
                },
              },
            },
          ],
          textRef: [3, 4],
        },
      ],
    },
  },
  {
    cardNo: "BSTH08.5-R13",
    combinedBoost: 4000,
    orikaId: 229,
    orikaIndex: 238,
    name: "能面・鬼（怒）",
    printedCategory: "brave",
    colors: ["red"],
    cost: 5,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■フラッシュ",
      "2コスト支払うことで、相手の創界神ネクサスのコア3個をボイドに置く。",
      "",
      "フラッシュ【アクセル：コスト5<赤><赤><赤><神>（この効果は手札から使用できる）】",
      "相手のスピリット/アルティメット1体を破壊する。",
      "",
      "【合体条件：面霊＆コスト6以上】",
      "【合体中】『このスピリットのアタック時』",
      "バトル終了時、相手のライフのコア1個を相手のリザーブに置く。",
    ],
    keywordTags: ["accel"],
    tribe: "面霊",
    image: "images/BSTH08.5-R13.webp",
    rarity: "R",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    accelData: {
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
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
              },
            },
          ],
          textRef: [4, 5],
        },
      ],
    },
    effects: [
      // 手元常駐: フラッシュ 2コスト支払うことで相手の創界神コア3個をボイドへ。
      // 「ことで」構文: pay_cost(2) → conditional_cost core_move（双方向ロールバック, 03c）。
      {
        executionMode: "optional",
        applicability: { zone: "set_aside" },
        timing: { kind: "activated", mode: "flash" },
        steps: [
          { action: { kind: "pay_cost", amount: 2 } },
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
              amount: 3,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [0, 1, 2],
      },
      // 【合体中】『このスピリットのアタック時』バトル終了時、相手ライフのコア1個を相手リザーブへ。
      {
        applicability: { combined: true },
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
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
    cardNo: "BSTH08.5-X01",
    orikaId: 230,
    orikaIndex: 239,
    name: "秦 こころ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 7,
    reductionSymbols: ["red", "red", "red", "god", "guide"],
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
        bp: 10000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカードの召喚コストは、自分の手元にある系統：「面霊」を持つカードのシンボルでも軽減できる。",
      "",
      "Lv1-Lv2-Lv3",
      "このスピリットが相手によってフィールドを離れるとき、自分の手元にある系統：「面霊」を持つブレイヴカード1枚を除外することで、同じ状態でフィールドに残る。この効果は相手の効果を受けない。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "バトル終了時、このスピリットのブレイヴすべてをトラッシュに置く。その後、手元にある系統：「面霊」を持つブレイヴカード1枚をこのスピリットに合体することで、このスピリットは回復する。",
    ],
    keywordTags: [],
    tribe: "化神・幻想・面霊",
    image: "images/BSTH08.5-X01.webp",
    rarity: "X",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 召喚コストは手元の系統:面霊カードのシンボルでも軽減できる。
      // extend_field_symbol_source CE (BSTH08.5-C20 と同一 primitive) を、召喚コスト
      // 計算が発生する通常召喚元 (手札/手元) にある間だけ自身に登録する。
      // 手元カードの category 制限は無し (原文はブレイヴ限定と書かれていない)。
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "extend_field_symbol_source",
              player: "self",
              targetScope: "source_card",
              zone: "set_aside",
              filter: { tribes: ["面霊"] },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // Lv1-3 相手による離脱時、手元の面霊ブレイヴ1枚除外で同状態で残る。相手効果を受けない。
      // (deck-reveal-cost-gated-destination-choice cluster 評価時の副産物: search_zone に
      // zone:"set_aside" を新設し、trash/hand と同じ generic pendingZoneSelection 経路へ
      // 合流させた。除外(cost) step の成否は ref_succeeded で後続 stay_on_field をゲートする
      // ため、discardCostGate 型の専用 Action フィールドを新設せずに表現できる。
      // executionMode:"optional" = 効果全体の発揮有無 (「〜することで」＝任意)。
      // preventionLevel:"unpreventable" = 「この効果は相手の効果を受けない」。)
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        preventionLevel: "unpreventable",
        steps: [
          {
            id: "bsth08-5-x01-exclude-brave-cost",
            action: {
              kind: "search_zone",
              zone: "set_aside",
              player: "self",
              filter: { category: ["brave"], tribes: ["面霊"] },
              count: 1,
              destination: "removed_from_game",
              mandatory: true,
            },
          },
          {
            action: { kind: "stay_on_field", target: { kind: "self" } },
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "bsth08-5-x01-exclude-brave-cost",
            },
          },
        ],
        textRef: [2, 3],
      },
      // Lv2-3 アタック時 ブレイヴ全トラッシュ→手元面霊ブレイヴ合体で回復。
      // (bsth08-5-brave-combine-from-set-aside cluster: brave_combine_effect
      // (dsl-types.ts:4259、ENGINE-brave-combine-third-party-target) が
      // 既存プリミティブとして解消。BSAZ01 の select_brave(noop+on_step)→
      // brave_combine_effect(source:{stepId}) と同型。host は「このスピリット」=
      // {kind:"self"} で確定 (合体先選択不要)。合体元は手元(set_aside)の
      // 系統:面霊ブレイヴ1枚に候補を絞る。選択0件なら ref_succeeded ゲートで
      // combine/recover ともスキップ。
      // 旧ブレイヴのトラッシュ移動は move_card 単独ではなく brave_separate_effect
      // (合体解除の唯一の正源、native-action-registry.ts brave_separate_effect) を先に
      // 挟む: move_card の汎用ゾーン移動は combined ブレイヴの attachedToInstanceId/
      // host.attachedChildrenIds を解除しない(pendingLeave 経由の破壊/消滅時のみ SBA が
      // 解除する。直接 move_card では非対象)ため、先に分離してから独立フィールドカードとして
      // トラッシュへ移す。「すべて」は現在の合体上限(通常1枚)に対応する単一 select+separate。)
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "field", player: "self" },
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["brave"], attachedToSource: true },
                count: "all",
              },
              to: { zone: "trash", player: "self" },
              count: "all",
            },
          },
          {
            executionMode: "optional",
            id: "x01-select-set-aside-brave",
            targetSelectionTiming: "on_step",
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["brave"], tribes: ["面霊"] },
                zone: "set_aside",
                count: 1,
              },
            },
          },
          {
            id: "x01-combine",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x01-select-set-aside-brave",
            },
            action: {
              kind: "brave_combine_effect",
              source: { stepId: "x01-select-set-aside-brave" },
              target: { kind: "self" },
            },
          },
          {
            connector: "conditional_cost",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x01-combine",
            },
            action: { kind: "recover", target: { kind: "self" } },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-X02",
    orikaId: 231,
    orikaIndex: 240,
    name: "[心綺楼]古明地 こいし",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "red", "guide"],
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
        bp: 8000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "【バースト：自分のライフ減少後】",
      "自分のライフが2以下のとき、このターンの間、相手のスピリット/アルティメット3体のLvを2つ下のものとして扱う。この効果で最低Lvより低くなったスピリット/アルティメットは消滅し、消滅した相手のスピリット/アルティメット1体につきボイドからコア1個を自分のライフに置く。その後、このカードをコストを支払わず召喚する。",
      "",
      "Lv2-Lv3『このスピリットのアタック時』",
      "バトル終了時、このスピリットのブレイヴをトラッシュに置く。その後、手元にある系統：「面霊」を持つブレイヴカード1枚をこのスピリットに合体することで、このスピリットを回復状態にする。",
    ],
    keywordTags: ["burst"],
    tribe: "天渡・幻想・面霊",
    image: "images/BSTH08.5-X02.webp",
    rarity: "X",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // 【バースト：自分のライフ減少後】ライフ2以下のとき相手3体をLv2下扱い→最低Lv未満で消滅・ライフ補充→召喚。
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
        },
        steps: [
          {
            id: "x02-level-down",
            action: {
              kind: "override_properties",
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
              properties: { level: { delta: -2 } },
              duration: { scope: "turn" },
            },
            condition: [{ kind: "life_value", player: "self", max: 2 }],
          },
          {
            id: "x02-vanish-below-min",
            connector: "sequential",
            action: {
              kind: "vanish",
              target: {
                kind: "filter",
                player: "opponent",
                stepId: "x02-level-down",
                filter: { belowOwnMinimumLevel: true },
                count: "all",
              },
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x02-vanish-below-min",
            },
            action: {
              kind: "core_move",
              from: { kind: "void", player: "self" },
              to: { kind: "life", player: "self" },
              amount: {
                source: {
                  kind: "cards_from_ref",
                  stepId: "x02-vanish-below-min",
                },
              },
            },
          },
          {
            connector: "sequential",
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv2-3 アタック時 ブレイヴ整理→手元面霊ブレイヴ合体で回復状態に。
      // (bsth08-5-brave-combine-from-set-aside cluster、BSTH08.5-X01 effects[2] と同型)
      {
        timing: {
          kind: "card_event",
          event: "attack",
          deferredTo: "battle_end",
        },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "field", player: "self" },
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["brave"], attachedToSource: true },
                count: 1,
              },
              to: { zone: "trash", player: "self" },
              count: 1,
            },
          },
          {
            executionMode: "optional",
            id: "x02-select-set-aside-brave",
            targetSelectionTiming: "on_step",
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["brave"], tribes: ["面霊"] },
                zone: "set_aside",
                count: 1,
              },
            },
          },
          {
            id: "x02-combine",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x02-select-set-aside-brave",
            },
            action: {
              kind: "brave_combine_effect",
              source: { stepId: "x02-select-set-aside-brave" },
              target: { kind: "self" },
            },
          },
          {
            connector: "conditional_cost",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "x02-combine",
            },
            action: {
              kind: "set_exhaust_state",
              state: "recovered",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-X03",
    orikaId: 232,
    orikaIndex: 241,
    name: "[創界神/能楽の神]摩多羅 隠岐奈",
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
    symbolColors: ["god"],
    textLines: [
      "このネクサスは創界神ネクサス対象の効果しか受けない。このネクサスには神託と創界神ネクサス対象の効果でしかコアを置けず、そのコアは創界神ネクサス対象の効果しか受けず移動できない。",
      "",
      "【神託：〔面霊／天渡／化神＆コスト3以上〕〔ブレイヴ＆【アクセル】を持つ〕】",
      "◆対象の自分のスピリット/ブレイヴの召喚/煌臨/【アクセル】の使用をしたとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
      "",
      "Lv1-Lv2 このネクサスのシンボルは、赤/導としても扱う。",
      "",
      "【神技：3】Lv1-Lv2 フラッシュ",
      "〔ターンに1回、このネクサスのコア3個をボイドに置く〕自分のデッキを3枚オープンし、その中の系統：「面霊」を持つ、ブレイヴカードすべてか、スピリットカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "【神域】Lv2",
      "手元にある系統：「面霊」を持つブレイヴカードすべては相手の効果を受けない。",
    ],
    keywordTags: ["accel", "enter_field_core_placement_forbidden"],
    tribe: "創界神・面霊・秘神",
    image: "images/BSTH08.5-X03.webp",
    rarity: "X",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 創界神ネクサス本体ルール (textLines[0]) ＋【神託：〔面霊／天渡／化神＆コスト3以上〕
    // 〔ブレイヴ＆【アクセル】を持つ〕】(textLines[2-4]) は grandwalkerData 基盤で表現。
    // 第1条件は◆行（スピリット/ブレイヴ）とブレイヴ専用の第2条件から categories:["spirit"]
    // （BSTH003-X01 と同じ読み）。〔【アクセル】を持つ〕= hasMechanic:["accel"] (= accelData 保持)。
    // 配置時神託は標準動作（同名創界神なし条件＋デッキ上3枚）のため placementOracle 省略。
    // 【神技：3】(textLines[8-9]) は divineSkills 経路（BSTH05.5-X02 等と同型）。原文に
    // 「開始時」等のステップ限定が無い素のフラッシュのため timing:"flash"（BSTH003-X01 系の
    // phase-start 限定とは異なる。同ファイル該当コメント参照）。デッキ3オープン後の
    // 「面霊ブレイヴすべて」か「面霊スピリット1枚」の排他選択は
    // DeckRevealPick.exclusiveGroup（本 cluster で新設）で表現する。
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent", "use_accel"],
      oracleConditions: [
        {
          tribes: ["面霊", "天渡", "化神"],
          categories: ["spirit"],
          minCost: 3,
        },
        { categories: ["brave"], hasMechanic: ["accel"] },
      ],
      divineSkills: [
        {
          label: "divine_skill",
          coreCost: 3,
          timing: "flash",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          effects: [
            {
              timing: { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "deck_reveal",
                    revealCount: 3,
                    picks: [
                      {
                        count: -1,
                        filter: { category: ["brave"], tribes: ["面霊"] },
                        mandatory: true,
                        exclusiveGroup: "brave_or_spirit",
                      },
                      {
                        count: 1,
                        filter: { category: ["spirit"], tribes: ["面霊"] },
                        mandatory: true,
                        exclusiveGroup: "brave_or_spirit",
                      },
                    ],
                    remainder: "trash",
                  },
                },
              ],
              textRef: [8, 9],
            },
          ],
        },
      ],
    },
    effects: [
      // Lv1-Lv2 このネクサスのシンボルは、赤/導としても扱う。
      {
        timing: { kind: "continuous" },
        steps: [
          { action: { kind: "treat_as", aspects: ["symbol"], asColor: "red" } },
          {
            action: { kind: "treat_as", aspects: ["symbol"], asColor: "guide" },
            connector: "simultaneous",
          },
        ],
        textRef: [6],
      },
      // 【神域】Lv2 手元の面霊ブレイヴカードすべては相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["brave"], tribes: ["面霊"] },
                count: "all",
                zone: "set_aside",
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [11, 12],
      },
    ],
  },
  {
    cardNo: "BSTH08.5-X04",
    combinedBoost: 5000,
    orikaId: 233,
    orikaIndex: 242,
    name: "希望の面",
    printedCategory: "brave",
    colors: ["red"],
    cost: 6,
    reductionSymbols: ["red", "red", "god"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
    ],
    symbolColors: ["red"],
    textLines: [
      "このカードは効果以外で召喚できず、このカードの効果以外で手元に置けない。",
      "",
      "手元にあるこのカードは、以下の効果を発揮する。",
      "■自分がこのカードを除外するとき、かわりに1コスト支払うことができる。",
      "",
      "フラッシュ【アクセル：コスト5<赤><赤><赤><神>（この効果は手札から使用できる）】",
      "自分はデッキから1枚ドローできる。",
      "",
      "【合体条件：面霊＆コスト6以上】",
      "【合体中】『このスピリットのアタック時』",
      "このスピリットに自分の手元にある系統：「面霊」を持つブレイヴカードすべてのシンボルを追加する。",
    ],
    keywordTags: ["accel"],
    tribe: "天渡・面霊",
    image: "images/BSTH08.5-X04.webp",
    rarity: "X",
    pack: "BSTH08.5 東方心綺楼",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    braveCondition: { tribes: ["面霊"], minCost: 6 },
    accelData: {
      timing: "flash",
      cost: 5,
      reduction: ["red", "red", "red", "god"],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          executionMode: "optional",
          steps: [{ action: { kind: "draw", count: 1 } }],
          textRef: [5, 6],
        },
      ],
    },
    effects: [
      // このカードは効果以外で召喚できない。restrict_use restrictedKinds:["summon"]で
      // 通常召喚のみ禁止し、このカード自身のアクセル（手元に置く唯一の効果経路）は許可する。
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "restrict_use",
              player: "self",
              filter: { cardName: "self" },
              duration: { scope: "permanent" },
              restrictedKinds: ["summon"],
              onlyNormalUse: true,
            },
          },
        ],
        textRef: [0],
      },
      // このカードの効果以外で手元に置けない。destination-zone-scoped resistance
      // (effect_resistance resistsOutcome:"enter_zone" + entryZone:"set_aside",
      // ENGINE-set-aside-entry-restriction) で、bounce(destination:"set_aside") や
      // deck_reveal picks[].destination:"set_aside"、return_from_trash/
      // swap_hand_trash(destination:"set_aside") 等、第三者ゾーン移動効果による
      // 手元への移動を阻止する。このカード自身のアクセルによる手元配置は
      // 上記アクション経路を通らないため貫通する。target は filter+count:-1
      // (dynamic 経路) にして selfCard の zone===field 限定 (resolveTargetCards)
      // を回避する。applicability.zone は continuous 効果登録が可能な全ゾーン
      // (REBUILD_ZONES: field / EXTRA_APPLICABILITY_ZONES: hand/set_aside/trash/
      // revealed) を明示する。"revealed" はデッキオープン中の一時ゾーンで、
      // 既に場に無い別の自分の希望の面 (このカードの同名カード) が手札/手元/
      // トラッシュ/フィールドにいて CE 登録済みなら、デッキから新たにオープンされた
      // 希望の面もその CE の targetFilter (cardName:"self", class-wide) に自動で
      // マッチし保護対象になる。
      // 既知の限定 (エンジン全体の制約): `hasBlockingPendingSelection`
      // (effect-interpreter.ts) が pendingDeckReveal 等の未解決 pending 中は
      // continuous 効果の新規登録を止めるため、盤面上に希望の面が1枚も存在しない
      // 状態で、そのデッキ内唯一の1枚を deck_reveal がオープン→同一解決チェーン内で
      // hand_or_set_aside_choice により手元へ選ぶケースだけは、CE が登録される前に
      // 選択が確定してしまい阻止できない (ENGINE-set-aside-entry-restriction
      // adversarial verifier 2026-07-31 round1 指摘、bounce/return_from_trash/
      // swap_hand_trash 等の第三者経路はこの制約と無関係で問題なく阻止できる)。
      {
        applicability: {
          zone: ["hand", "set_aside", "field", "trash", "revealed"],
        },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: {
                kind: "filter",
                player: "self",
                filter: { cardName: "self" },
                count: -1,
              },
              resistsOutcome: "enter_zone",
              entryZone: "set_aside",
              source: "all",
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [0],
      },
      // 手元常駐: 自分がこのカードを除外するとき、かわりに1コスト支払える。
      // = effect_resistance(resistsOutcome:remove_from_game, source:"self",
      //   replacement:pay_cost(amount:1))。M11 (手札へ戻す, move_to) と同型だが、
      //   ゾーン移動を伴わずリザーブから1コスト支払うことで手元残留を選べる
      //   (ENGINE-set-aside-exit-replacement-choice Step2, replacement.kind:"pay_cost")。
      {
        applicability: { zone: "set_aside" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_resistance",
              target: { kind: "self" },
              resistsOutcome: "remove_from_game",
              source: "self",
              duration: { scope: "permanent" },
              replacement: { kind: "pay_cost", amount: 1 },
            },
          },
        ],
        textRef: [2, 3],
      },
      // 【合体中】『このスピリットのアタック時』手元の面霊ブレイヴすべてのシンボルを追加する。
      // symbolSource:"zone_symbols" (zone:"set_aside", filter:面霊&ブレイヴ) で自分の手元にある
      // 該当カードそれぞれの base symbolColors を個別バンドルとして live 加算する。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbolSource: {
                kind: "zone_symbols",
                zone: "set_aside",
                player: "self",
                filter: { category: ["brave"], tribes: ["面霊"] },
              },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [8, 9, 10],
      },
    ],
  },
];
