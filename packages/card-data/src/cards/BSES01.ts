import type { CardDefinition } from "@orica/rules-core";

export const BSES01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSES01-C01",
    orikaId: 396,
    orikaIndex: 411,
    name: "Para-RAID Activate",
    printedCategory: "magic",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "マジック以外の自分の効果でデッキからオープンされた/トラッシュに置かれたこのカードは手札に加えられる。",
      "",
      "系統：「指揮官」を持つ自分の導界者ネクサスが相手の効果の対象になるとき、フィールドにあるこのカードを破棄することで、このステップの間、対象1つは相手によってフィールドを離れず、コア2個より少なくならない。",
      "",
      "フラッシュ",
      "自分のデッキを上から3枚オープンできる。その中の系統：「指揮官」/「８６」を持つネクサスカード/ブレイヴカード1枚を手札に加える。残ったカードはデッキの下に戻すか破棄する。その後、このカードをフィールドに置ける。",
    ],
    keywordTags: [],
    image: "images/BSES01-C01.webp",
    rarity: "C",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0] マジック以外の自分の効果でオープン/トラッシュ行き時、このカードを手札に加えられる。
      //   BSFT01-C04 [0] 同型（trigger_source_player + 自己回収）に「マジック以外」発生源
      //   限定を加えたもの。新 ConditionClause trigger_source_category(exclude:[magic]) で
      //   発生源カードの印字カテゴリを除外条件にする。TriggerContext.sourceCategory は
      //   processMovedToTrashEffects / finalizeDeckReveal の呼び出し側で srcDef.printedCategory
      //   を流し込む。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "move", destination: "hand" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_source_category", exclude: ["magic"] },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [{ action: { kind: "move_self", destination: "hand" } }],
        executionMode: "optional",
        textRef: [0],
      },
      // [2] 指揮官の自分の導界者ネクサスが相手効果の対象時、このカードを破棄し対象を耐性化。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            category: ["nexus"],
            tribes: ["指揮官"],
            targetsGrandwalker: "only",
            hasMechanic: ["guided"],
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
              kind: "effect_resistance",
              target: { kind: "trigger_related_instance" },
              resistsOutcome: ["leave_field", "core_below_min"],
              source: "opponent",
              duration: { scope: "step" },
              coreMinimum: 2,
            },
          },
        ],
        textRef: [2],
      },
      // [4,5] フラッシュ: デッキ上3枚オープン→指揮官/86 のネクサス/ブレイヴ1枚を手札→残りデッキ下or破棄。その後このカードをフィールドに置ける。
      //   後段「その後、このカードをフィールドに置ける」= engine-field-magic-self-placement 最小実装。
      //   move_self(destination:"field") を任意 step (executionMode:"optional") として追加する。
      //   move_card(from.zone 必須) は使わない: resolveMagicMainAndMoveToTrash (magic-system.ts) が
      //   deck_reveal 等の pending 生成有無に関わらず、この effect の最初の同期解決直後に
      //   moveMagicCardToTrash(requireInUse:true) を無条件で呼ぶため、pendingDeckReveal の pick 解決を
      //   経てこの step に到達する時点でこのカードは in_use ではなく既に trash にある
      //   (adversarial verifier 2026-07-09 round1 refute で実測確認、resolveDeferredMagicStack 経由の
      //   board test で確認)。move_self は sourceInstanceId を現在ゾーン非依存で直接動かすため、
      //   trash からでも in_use のままでも (deck が空で pending が立たない edge case) 一貫して動作する。
      //   実行を選べばこのカードはフィールドに残り、辞退すれば trash のまま (通常の使用後処理どおり)。
      //   場に残ったこのカードは effects[1] (=[2] 指揮官保護) の破棄コスト源として zone:"field" 判定のみで
      //   既に消費可能 (専用の「フィールドに置かれている間」常時効果は本カードのテキストに無いため未追加)。
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        executionMode: "optional",
        steps: [
          {
            executionMode: "optional",
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["nexus", "brave"],
                    tribes: ["指揮官", "８６"],
                  },
                  destination: "hand",
                  mandatory: true,
                },
              ],
              remainder: "bottom_or_trash",
            },
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
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSES01-C02",
    combinedBoost: 3000,
    orikaId: 394,
    orikaIndex: 412,
    name: "[天狼星]クジョー・ニコ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは、召喚できる。",
      "",
      "『このブレイヴの召喚時』",
      "〔ターンに1回：同名〕自分のデッキを上から3枚オープンできる。その中の系統：「８６」を持つブレイヴカード1枚を手札に加えられる。残ったカードは、デッキの下に戻すか破棄する。",
      "【合体条件：「ジャガーノート」】",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-C02.webp",
    rarity: "C",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる。needs-dsl.w1.jsonl。
      {
        // フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
        // (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [5,6] 『このブレイヴの召喚時』〔ターンに1回:同名〕デッキ上3枚オープン→86 ブレイヴ1枚を手札→残りデッキ下or破棄。
      {
        timing: { kind: "card_event", event: "summon" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 3,
              picks: [
                {
                  count: 1,
                  filter: { category: ["brave"], tribes: ["８６"] },
                  destination: "hand",
                },
              ],
              // 「デッキの下に戻すか破棄」per-remainder choice は enum 非対応のため bottom。needs-dsl.w1.jsonl。
              remainder: "bottom_or_trash",
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSES01-C03",
    orikaId: 397,
    orikaIndex: 413,
    name: "迎撃砲",
    printedCategory: "nexus",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 0,
      },
    ],
    symbolColors: ["white"],
    textLines: [
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは、配置できる。",
      "",
      "Lv1 スタック『自分のアタックステップ』",
      "〔ターンに1回：同名〕ブロック宣言する相手のスピリット/アルティメット1体を手札に戻せる。",
      "",
      "Lv1『自分のアタックステップ』",
      "自分の「ジャガーノート」による相手のライフの減少は、自分のカウント6以上で、導界者ネクサスの「レーナ」がいるなら、このネクサスのコア2個をボイドに置くことで、相手の効果では防げない。",
    ],
    keywordTags: [],
    image: "images/BSES01-C03.webp",
    rarity: "C",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 迎撃砲（ネクサス）。[0,1] 自己配置許可と [3,4] スタックバウンス、[6,7] ライフ減少耐性を表現。
    // [0,1] フラッシュ『お互いのアタックステップ』「手札/手元にあるこのカードは、配置できる」。
    //   ネクサス自己配置許可（手札/手元からの self-deploy permission）。getHandSummonPermissionSpec が
    //   activated + applicability.zone(hand/set_aside) + 単一 summon target:self を検出し、ネクサス定義
    //   なので availability が place_nexus 適法手として生成（spirit summon 許可のネクサス版）。
    effects: [
      // [0,1] フラッシュ『お互いのアタックステップ』「手札/手元にあるこのカードは、配置できる」。
      {
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        applicability: { zone: ["hand", "set_aside"] },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
            },
          },
        ],
        textRef: [0, 1],
      },
      // [3,4] Lv1 スタック『自分のアタックステップ』〔ターンに1回:同名〕ブロック宣言する相手の
      //   スピリット/アルティメット1体を手札に戻せる（BSTH002-転醒R01(B)[5,6] と同型）。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                  battleState: "blocking",
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // [6,7] Lv1『自分のアタックステップ』「自分の『ジャガーノート』による相手のライフの減少は、
      //   自分のカウント6以上で、導界者ネクサスの『レーナ』がいるなら、このネクサスのコア2個をボイドに
      //   置くことで、相手の効果では防げない」。
      //   [P3-125 Step5 実装 2026-07-21] Step4 は `timing:{kind:"activated",mode:"main"}` を
      //   試みて revert (main ステップ限定の legal-action 経路にしか乗らず dead action)。
      //   本実装は「ことで」コスト付き・見出しフラッシュ/スタック無しの既存 precedent
      //   (`BSKB01-C04` textRef:[3,4]) と同型で、コストを登録時 1 回きりの反応的
      //   `game_event` トリガー側に分離する。本カードの「ライフ減少が発生する直前」の反応的
      //   窓は、ジャガーノートの**アタック宣言成立**（`event:"attack"`、P3-14 C-2
      //   `queueBattleDeclarationTriggers` 経由、`state.activeAttack` 確定後で attackId 有効）
      //   で近似する。ブロック/バトル解決はこの後に続くため、コスト支払い（このネクサスのコア2個
      //   ボイド）→ `grant_life_damage_source_prevention_immunity`（P3-125 Step3 新設、
      //   sourceFilter をジャガーノートの cardName に絞る）を先に確定させれば、後続のバトル解決
      //   ライフ減少（`battle-actions.ts` `getUnblockedLifeDamage`）が正しく防御貫通で消費できる。
      //   `duration:{scope:"battle"}` は `pre_declaration_attack`（attackId:null、tentative）
      //   ではなく `attack` game_event（activeAttack 確定後）を使うことで
      //   `createdAtAttackId` が正しく設定され、`legal-actions-shared.ts:1729-1748` の
      //   battle/attack scope 失効判定が機能する。「導界者ネクサスの『レーナ』がいるなら」は
      //   `field_has` ConditionClause が `hasMechanic`/`targetsGrandwalker` を持たないため
      //   （通常ネクサス「ヴラディレーナ・ミリーゼ」(`BSES01-CX01`) との名前衝突を避ける必要が
      //   ある、同ファイル line 1391-1397 の CardFilter precedent と同じ理由）、CardFilter を
      //   取れる `cards_in_zone` ConditionClause で代替。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "attack",
          triggerFilter: { cardName: { contains: "ジャガーノート" } },
        },
        executionMode: "optional",
        condition: [
          { kind: "count_value", player: "self", min: 6 },
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "field",
            filter: {
              category: ["nexus"],
              cardName: { contains: "レーナ" },
              targetsGrandwalker: "only",
              hasMechanic: ["guided"],
            },
            min: 1,
          },
        ],
        steps: [
          {
            id: "c03-life-damage-unpreventable-cost",
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: 2,
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "grant_life_damage_source_prevention_immunity",
              player: "self",
              sourceFilter: { cardName: { contains: "ジャガーノート" } },
              duration: { scope: "battle" },
            },
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "c03-life-damage-unpreventable-cost",
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSES01-C04",
    orikaId: 398,
    orikaIndex: 414,
    name: "軍用地図",
    printedCategory: "magic",
    colors: ["white"],
    cost: 3,
    reductionSymbols: ["white", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは相手の効果を受けない。デッキからオープンされた/トラッシュにあるこのカードは手札に加えられず、入れ替えられない。",
      "",
      "フラッシュ",
      '〔ターンに1回：同名〕手札/手元の系統：「８６」を持つブレイヴカード1枚を1コスト支払って召喚できる。自分のカウント4以上のとき、次の自分のスタートステップまで、この効果で召喚したカードと同じカード名のブレイヴと合体している自分のスピリットすべてに、"このスピリットは「ブロックされない」相手のスピリット/アルティメットをブロックできる。さらに、〔ターンに1回：同名〕フラッシュタイミングでこのスピリットは手札に戻せる。"を与える。',
    ],
    keywordTags: [],
    image: "images/BSES01-C04.webp",
    rarity: "C",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 軍用地図（マジック）。
    // [0]「このカードは相手の効果を受けない」= デッキ等の非公開領域を除く明示ゾーン束縛の continuous effect_immunity(self)。
    //   「デッキからオープンされた/トラッシュにあるこのカードは手札に加えられず、入れ替えられない」
    //   = revealed/moved_to_trash の自カード手札追加・swap 受理を禁止する blocked disposition。
    // [2,3] フラッシュ〔ターンに1回:同名〕手札/手元の86ブレイヴ1枚を1コスト支払って召喚。
    //   カウント4以上で、この効果で召喚したカードと同じカード名のブレイヴと合体している
    //   自分のスピリットすべてへ block_unblockable と flash 自己バウンス起動権を付与。
    effects: [
      // [0] このカードは相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        applicability: {
          zone: ["hand", "set_aside", "in_use", "trash", "field"],
        },
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
      // [2,3] フラッシュ〔ターンに1回:同名〕手札/手元の86ブレイヴ1枚を1コスト支払って召喚。
      //   後段は「この効果で召喚したカード」と同じカード名の合体ブレイヴを
      //   attachedBrave.cardName:from_step_ref で照合する。
      {
        timing: { kind: "activated", mode: "flash" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            id: "summon-86-brave",
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "set_aside"],
                filter: {
                  category: ["brave"],
                  tribes: ["８６"],
                },
                count: 1,
              },
              costModifier: { fixedPayment: 1 },
            },
          },
          {
            stepCondition: { kind: "ref_succeeded", stepId: "summon-86-brave" },
            condition: [{ kind: "count_value", player: "self", min: 4 }],
            action: {
              kind: "block_unblockable",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: {
                  category: ["spirit"],
                  attachedBrave: {
                    cardName: {
                      kind: "from_step_ref",
                      stepId: "summon-86-brave",
                    },
                  },
                },
              },
              duration: { scope: "step", step: "start", whose: "self" },
            },
          },
          {
            stepCondition: { kind: "ref_succeeded", stepId: "summon-86-brave" },
            condition: [{ kind: "count_value", player: "self", min: 4 }],
            // 引用符内の同名ターン制限は、外側の召喚効果とは別の付与起動権に属する。
            // `sourceText` を内側 Effect の本文 carrier とし、監査でも両方の scope を
            // 別々に照合する。
            prompt: {
              sourceText:
                "このスピリットは「ブロックされない」相手のスピリット/アルティメットをブロックできる。さらに、〔ターンに1回：同名〕フラッシュタイミングでこのスピリットは手札に戻せる。",
            },
            action: {
              kind: "grant_effect",
              target: {
                kind: "filter",
                player: "self",
                count: "all",
                filter: {
                  category: ["spirit"],
                  attachedBrave: {
                    cardName: {
                      kind: "from_step_ref",
                      stepId: "summon-86-brave",
                    },
                  },
                },
              },
              duration: { scope: "step", step: "start", whose: "self" },
              grantedEffect: {
                timing: { kind: "activated", mode: "flash" },
                activationLabel: "none",
                usageLimit: {
                  kind: "per_card_name",
                  duration: "turn",
                  maxCount: 1,
                },
                executionMode: "optional",
                steps: [
                  {
                    action: {
                      kind: "bounce",
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
      // [0] デッキからオープンされたこのカードは手札に加えられず、入れ替えられない。
      {
        timing: { kind: "card_event", event: "revealed" },
        executionMode: "mandatory",
        cardEventDisposition: { kind: "blocked" },
        steps: [],
        textRef: [0],
      },
      // [0] トラッシュにあるこのカードは手札に加えられず、入れ替えられない。
      {
        timing: { kind: "card_event", event: "moved_to_trash" },
        executionMode: "mandatory",
        cardEventDisposition: { kind: "blocked" },
        steps: [],
        textRef: [0],
      },
    ],
  },
  {
    cardNo: "BSES01-C05",
    combinedBoost: 3000,
    orikaId: 399,
    orikaIndex: 415,
    name: "[鷹揚]ハルト・キーツ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは、召喚できる。",
      "",
      "『このブレイヴの召喚時』",
      "〔ターンに1回：同名〕自分はデッキの下から1枚ドローできる。",
      "【合体条件：「ジャガーノート」】",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-C05.webp",
    rarity: "C",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる。needs-dsl.w1.jsonl。
      {
        // フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
        // (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [5,6] 『このブレイヴの召喚時』〔ターンに1回:同名〕デッキの下から1枚ドローできる。
      {
        timing: { kind: "card_event", event: "summon" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [{ action: { kind: "draw", count: 1, position: "bottom" } }],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSES01-C06",
    combinedBoost: 2000,
    orikaId: 400,
    orikaIndex: 416,
    name: "[桜花]カイエ・タニヤ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは、召喚できる。",
      "",
      "【合体条件：「ジャガーノート」】",
      "【合体中】〔ターンに1回：同名〕このスピリットが相手によってフィールドを離れるとき、ボイドからコア2個を自分のフィールド/リザーブに置ける。",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-C06.webp",
    rarity: "C",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる。needs-dsl.w1.jsonl。
      {
        // フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
        // (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [8] 【合体中】〔ターンに1回:同名〕このスピリットが相手によってフィールドを離れるとき、ボイドからコア2個を自分のフィールド/リザーブに置ける。
      {
        applicability: {
          combined: true,
        },
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        usageLimit: {
          kind: "per_card_name",
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
              splitDestinations: {
                destinations: [
                  {
                    location: {
                      kind: "field",
                      player: "self",
                    },
                    cap: 2,
                  },
                  {
                    location: {
                      kind: "reserve",
                      player: "self",
                    },
                    cap: 2,
                  },
                ],
              },
              amount: 2,
            },
          },
        ],
        textRef: [6],
      },
    ],
  },
  {
    cardNo: "BSES01-CX01",
    orikaId: 401,
    orikaIndex: 417,
    name: "[白銀の契約者]ヴラディレーナ・ミリーゼ",
    printedCategory: "nexus",
    colors: ["white"],
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
        requiredCount: 4,
        bp: 0,
      },
    ],
    symbolColors: ["white", "guide"],
    symbolColorEntries: [["white", "guide"]],
    textLines: [
      "【真・導託：〔８６＆ブレイヴ〕】",
      "◆対象の自分のブレイヴを召喚したとき、このネクサスにコア+1できる。",
      "◆〔ターンに1回：同名〕このネクサスを配置したとき、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき、このネクサスにコア+1する。",
      "",
      "【復活】メイン〔ターンに1回：同名〕魂状態のこのカードは配置できる。",
      "",
      "Lv1-Lv2【契約技:2】『自分のメインステップ』",
      "〔ターンに1回、このネクサスのコア2個をボイドに置く〕自分のカウント+2する。さらに、自分の黄のシンボルがあるとき、自分はデッキの下から1枚ドローでき、このターンの間、相手は効果でバトル/ターン/ステップを終了できない。自分のカウント4以上のとき、この「終了できない」効果は相手の効果では防げない。",
      "",
      "LV2 【契約域】",
      "ターンに1回ずつ、自分のジャガーノートが、相手の効果の対象になるときと、バトル終了時、対象1体につきこのネクサスのコア2個をボイドに置くことで、対象を手札に戻す。",
    ],
    keywordTags: [
      "soul_state",
      "contract",
      "guided_nexus",
      "enter_field_core_placement_forbidden",
    ],
    // 導託 [0,1,2] は grandwalkerData + エンジン基盤 (oracle-system) で表現。
    // 【契約技:2】: count+2 後、黄シンボルがあればドローは任意、終了制限はドロー選択に依存しない。
    grandwalkerData: {
      kind: "guided",
      oracleConditions: [{ tribes: ["８６"], categories: ["brave"] }],
      // 真・導託は「対象の自分のブレイヴを召喚したとき」だけ。省略時の互換既定値は
      // 煌臨等の通常 oracle trigger まで許してしまうため、印字どおり summon に限定する。
      oracleTriggerKinds: ["summon"],
      placementOracle: { sameNameGate: false, turnLimit: "per_card_name" },
      divineSkills: [
        {
          label: "contract_skill",
          coreCost: 2,
          timing: "main",
          minLevel: 1,
          maxLevel: 2,
          turnLimit: "once",
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "count_increase",
                    player: "self",
                    amount: 2,
                  },
                },
                {
                  action: {
                    kind: "draw",
                    count: 1,
                    position: "bottom",
                  },
                  condition: [
                    {
                      kind: "field_has",
                      player: "self",
                      symbolColors: ["yellow"],
                    },
                  ],
                  executionMode: "optional",
                },
                {
                  action: {
                    kind: "restrict_end_battle",
                    player: "opponent",
                    duration: { scope: "turn" },
                    unpreventableIf: [
                      { kind: "count_value", player: "self", min: 4 },
                    ],
                  },
                  condition: [
                    {
                      kind: "field_has",
                      player: "self",
                      symbolColors: ["yellow"],
                    },
                  ],
                },
                {
                  action: {
                    kind: "restrict_end_turn",
                    player: "opponent",
                    duration: { scope: "turn" },
                    unpreventableIf: [
                      { kind: "count_value", player: "self", min: 4 },
                    ],
                  },
                  condition: [
                    {
                      kind: "field_has",
                      player: "self",
                      symbolColors: ["yellow"],
                    },
                  ],
                },
                {
                  action: {
                    kind: "restrict_end_step",
                    player: "opponent",
                    duration: { scope: "turn" },
                    unpreventableIf: [
                      { kind: "count_value", player: "self", min: 4 },
                    ],
                  },
                  condition: [
                    {
                      kind: "field_has",
                      player: "self",
                      symbolColors: ["yellow"],
                    },
                  ],
                },
                {
                  action: {
                    kind: "restrict_end_attack_step",
                    player: "opponent",
                    duration: { scope: "turn" },
                    unpreventableIf: [
                      { kind: "count_value", player: "self", min: 4 },
                    ],
                  },
                  condition: [
                    {
                      kind: "field_has",
                      player: "self",
                      symbolColors: ["yellow"],
                    },
                  ],
                },
              ],
              textRef: [6, 7],
            },
          ],
        },
      ],
    },
    tribe: "導界者・指揮官",
    image: "images/BSES01-CX01.webp",
    rarity: "CX",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [4] 【復活】メイン〔ターンに1回:同名〕魂状態のこのカードは配置できる。
      //   applicability.soulState + place(self) で魂状態からの配置として扱う。
      {
        timing: { kind: "activated", mode: "main" },
        applicability: { soulState: true },
        usageLimit: { kind: "per_card_name", duration: "turn" },
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
      // [9,10] LV2【契約域】自分のジャガーノートが相手効果の対象になるとき、
      //   CX01 のコア2個をボイドに置くことで対象を手札へ戻す。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "targeted",
          triggerFilter: {
            cardName: [{ contains: "ジャガーノート" }],
          },
          cause: ["opponent_effect"],
        },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: [{ kind: "per_instance", duration: "turn" }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: {
                source: { kind: "trigger_related_instances" },
                multiplier: 2,
              },
            },
          },
          {
            action: {
              kind: "bounce",
              target: { kind: "trigger_related_instances" },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [9, 10],
      },
      // [9,10] LV2【契約域】自分のジャガーノートのバトル終了時も同じコストで対象を手札へ戻す。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "battle_end",
          triggerFilter: {
            cardName: [{ contains: "ジャガーノート" }],
          },
        },
        executionMode: "optional",
        condition: [{ kind: "min_level", value: 2 }],
        usageLimit: [{ kind: "per_instance", duration: "turn" }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "this_card" },
              to: { kind: "void", player: "self" },
              amount: {
                source: { kind: "trigger_related_instances" },
                multiplier: 2,
              },
            },
          },
          {
            action: {
              kind: "bounce",
              target: { kind: "trigger_related_instances" },
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSES01-M01",
    combinedBoost: 4000,
    orikaId: 402,
    orikaIndex: 418,
    name: "[戦人狼]ライデン・シュガ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは、召喚できる。",
      "",
      "『このブレイヴの召喚時』",
      "相手のバースト1つを手札に戻せる。または、〔ゲームに1回:同名〕このターンの間、相手はスタック効果を発揮できない。",
      "【合体条件：「ジャガーノート」】",
    ],
    keywordTags: ["burst"],
    tribe: "８６",
    image: "images/BSES01-M01.webp",
    rarity: "M",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。
      //   applicability.combined=false で「スピリット状態(=合体していない)」に限定（C05/C06 precedent）。
      {
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
      //   (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果（C05/C06 precedent）。
      {
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [5,6] 『このブレイヴの召喚時』「相手のバースト1つを手札に戻せる」
      //   または「このターンの間、相手はスタック効果を発揮できない」。
      //   BSRK01-C06 で実装済の setBurstStates 対象アクションを destination:hand に拡張。
      //   後段は読点なし文言のため effect_source scope の restrict_stack で表現し、
      //   スタック効果を持つカード側の耐性で抜けられる (03d / external-qa qa-024/025)。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
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
              destination: "hand",
            },
            choice: [
              {
                action: {
                  kind: "restrict_stack",
                  player: "opponent",
                  duration: { scope: "turn" },
                  targetScope: "effect_source",
                  effectFilter: { activatedMode: ["stack"] },
                },
                usageLimit: {
                  kind: "per_card_name",
                  duration: "game",
                  maxCount: 1,
                },
              },
            ],
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSES01-M02",
    combinedBoost: 4000,
    orikaId: 403,
    orikaIndex: 419,
    name: "[笑う狐]セオト・リッカ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。〔ターンに1回：同名〕このとき、コストを支払わずに召喚できる。",
      "",
      "【合体条件：「ジャガーノート」】",
      "【合体中】フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕このスピリットを手札に戻せる。",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-M02.webp",
    rarity: "M",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる(ターンに1回はコストなし)。needs-dsl.w1.jsonl。
      {
        // フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
        // (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      {
        // 〔ターンに1回：同名〕このとき、コストを支払わずに召喚できる
        // (通常コスト召喚とは別モードとして free ＋ ターン1回同名で表現)。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
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
        textRef: [2, 3],
      },
      // [6,7] 【合体中】フラッシュ『お互いのアタックステップ』〔ターンに1回:同名〕このスピリットを手札に戻せる。
      {
        applicability: {
          combined: true,
        },
        timing: {
          kind: "activated",
          mode: "flash",
        },
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
          maxCount: 1,
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "bounce",
              target: {
                kind: "self",
              },
            },
          },
        ],
        textRef: [6, 7],
        timingScope: {
          player: "both",
          period: "attack",
        },
      },
    ],
  },
  {
    cardNo: "BSES01-M03",
    combinedBoost: 4000,
    orikaId: 404,
    orikaIndex: 420,
    name: "[雪魔女]アンジュ・エマ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "【合体条件：「ジャガーノート」】",
      "【合体中】『このスピリット/ブレイヴの召喚/アタック/ブロック時』",
      "〔ターンに1回：同名〕相手のスピリット/アルティメット1体を指定できる。このターンの間、対象はアタック/ブロックできない。",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-M03.webp",
    rarity: "M",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる。needs-dsl.w1.jsonl。
      {
        // フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
        // (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [7,8] 【合体中】『召喚/アタック/ブロック時』〔ターンに1回:同名〕相手1体を指定→このターン対象はアタック/ブロックできない。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        executionMode: "optional",
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
              restriction: ["attack", "block"],
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSES01-M04",
    combinedBoost: 4000,
    orikaId: 405,
    orikaIndex: 421,
    name: "[狙撃手]クレナ・ククミラ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードはコスト2として召喚できる。",
      "",
      "【合体条件：「ジャガーノート」】",
      "【合体中】『このスピリット/ブレイヴの召喚/アタック/ブロック時』",
      "〔ターンに1回：同名〕相手のスピリット/アルティメット/ネクサス1つをデッキの下に戻せる。自分の導界者ネクサスの「レーナ」のコア5個をボイドに置くことで、この効果の対象を+1する。",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-M04.webp",
    rarity: "M",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードはコスト2として召喚できる。needs-dsl.w1.jsonl。
      {
        applicability: {
          zone: ["hand", "set_aside"],
        },
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
        textRef: [2, 3],
      },
      // [7,8] 【合体中】『召喚/アタック/ブロック時』〔ターンに1回:同名〕相手のスピリット/アルティメット/ネクサス1つをデッキの下に戻せる。
      // 後段「自分の導界者ネクサスの『レーナ』のコア5個をボイドに置くことで対象+1」=
      // P3-14 D-6 choice 前置コスト型（基本=1体 / コスト払い=2体）。
      // mode step: choiceIndex 0 = 1体デッキ下（コスト不払い）/ choiceIndex 1 = レーナのコア5個→ボイド。
      // conditional_cost の後段で 2体（=対象+1）。コア不足や対象不在ならコスト含め全体不発（ことで双方向）。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            id: "mode",
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 1,
              },
              position: "bottom",
            },
            choice: [
              {
                action: {
                  kind: "core_move",
                  from: {
                    kind: "field_card",
                    player: "self",
                    filter: {
                      category: ["nexus"],
                      cardName: { contains: "レーナ" },
                      // 原文「自分の導界者ネクサスの『レーナ』」= guided 限定。
                      // targetsGrandwalker:"only" + hasMechanic:["guided"] で通常ネクサスを
                      // 排除し、grandwalker レーナのみを candidate にする
                      // (verifier 2026-06-23 round 10 lens 1)。
                      targetsGrandwalker: "only",
                      hasMechanic: ["guided"],
                    },
                  },
                  to: { kind: "void", player: "self" },
                  amount: 5,
                },
              },
            ],
          },
          {
            action: {
              kind: "send_to_deck",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate", "nexus"] },
                count: 2,
              },
              position: "bottom",
            },
            stepCondition: {
              kind: "ref_choice",
              stepId: "mode",
              choiceIndex: 1,
            },
            connector: "conditional_cost",
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSES01-R01",
    combinedBoost: 4000,
    orikaId: 406,
    orikaIndex: 422,
    name: "[黒妖犬]ダイヤ・イルマ",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "【合体条件：「ジャガーノート」】",
      "【合体中】『このスピリット/ブレイヴの召喚/アタック/ブロック時』",
      "〔ターンに1回：同名〕相手のスピリット/アルティメット1体を指定できる。このターンの間、対象の効果は発揮されない。",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-R01.webp",
    rarity: "R",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる。needs-dsl.w1.jsonl。
      {
        // フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
        // (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [7,8] 【合体中】『召喚/アタック/ブロック時』〔ターンに1回:同名〕相手1体を指定→このターン対象の効果は発揮されない。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: ["summon", "attack", "block"] },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: 1,
              },
              effectFilter: {},
              scope: "entire",
              duration: { scope: "turn" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSES01-R02",
    orikaId: 407,
    orikaIndex: 423,
    name: "スカベンジャー・ファイド",
    printedCategory: "spirit",
    colors: ["yellow"],
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
      "自分の効果でデッキからオープンされた/トラッシュに置かれたこのカードはセットできる。",
      "",
      "【ミラージュ：コスト1（このカードは手札からセットできる）】",
      "【セット中】",
      "自分のトラッシュにある系統：「８６」を持つカードは相手の効果を受けない。",
      "",
      "Lv1",
      "このスピリットは、アタック/ブロックできない。",
    ],
    keywordTags: [],
    tribe: "動器",
    image: "images/BSES01-R02.webp",
    rarity: "R",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    mirageData: { cost: 1, reduction: [] },
    effects: [
      // [0] 自分の効果でデッキからオープン/トラッシュへ置かれたこのカードを、
      // ミラージュ・コストを支払ってセットできる（手札セットではない）。
      {
        timing: { kind: "card_event", event: ["revealed", "moved_to_trash"] },
        cardEventDisposition: { kind: "set_as_mirage" },
        condition: [
          { kind: "trigger_source_player", player: "self" },
          { kind: "trigger_from_zone", zones: ["deck"] },
        ],
        steps: [],
        executionMode: "optional",
        textRef: [0],
      },
      // [3,4] 【セット中】自分のトラッシュの系統：「８６」を持つカードは相手の効果を受けない。
      {
        timing: { kind: "continuous" },
        applicability: { zone: ["mirage_set"] },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: { tribesRequired: ["８６"] },
                count: "all",
                zone: ["trash"],
              },
              duration: { scope: "while_set" },
            },
          },
        ],
        textRef: [3, 4],
      },
      // [7] Lv1 このスピリットは、アタック/ブロックできない。
      //   levelDefs が Lv1 のみ（=常時 Lv1）なので level applicability は不要。継続 prevent_battle。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [6, 7],
      },
    ],
  },
  {
    cardNo: "BSES01-R03",
    combinedBoost: 3000,
    orikaId: 408,
    orikaIndex: 424,
    name: "[火炎尾]レッカ・リン",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["guide"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードは召喚できる。",
      "",
      "【合体条件：「ジャガーノート」】",
      "【合体中】フラッシュ『自分のアタックステップ』",
      "このスピリットを破壊できる。",
      "",
      "【合体中】『このスピリットの破壊/消滅時』",
      "〔ターンに1回：同名〕相手のライフのコア1個をリザーブに置ける。この効果は自分による消滅では発揮されない。",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-R03.webp",
    rarity: "R",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードは召喚できる。needs-dsl.w1.jsonl。
      {
        // フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる
        // (通常コスト=軽減適用)。timingScope=both/attack の自己召喚許可効果。
        applicability: { zone: ["hand", "set_aside"] },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "summon", target: { kind: "self" } } }],
        textRef: [2, 3],
      },
      // [6,7] 【合体中】フラッシュ『自分のアタックステップ』このスピリットを破壊できる。
      {
        applicability: { combined: true },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "self", period: "attack" },
        executionMode: "optional",
        steps: [{ action: { kind: "destroy", target: { kind: "self" } } }],
        textRef: [6, 7],
      },
      // [9,10] 【合体中】『このスピリットの破壊/消滅時』〔ターンに1回:同名〕相手のライフのコア1個をリザーブに置ける。自分による消滅では発揮されない。
      // 破壊(destroy)と消滅(vanish)で別 card_event を登録。破壊は cause 不問（自分による破壊でも
      // 発火＝[6,7] 自壊コンボ）。消滅は「自分による消滅では発揮されない」のため self_effect を
      // 除く cause（opponent_effect / battle / state_based）でのみ発火。〔ターンに1回:同名〕は
      // 両 event で共有するため limitGroupId で使用回数を合算する。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: "destroy" },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        limitGroupId: "BSES01-R03-leave-reward",
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
        textRef: [9, 10],
      },
      {
        applicability: { combined: true },
        timing: {
          kind: "card_event",
          event: "vanish",
          // 「自分による消滅では発揮されない」: self_effect / state_based_self
          // (自分のコア移動由来 state-based 消滅) の双方を除外。
          // 自帰属の state-based vanish は deriveTriggerEventCauseFromPendingLeave で
          // state_based_self へ振り分けられるため、cause:["state_based"] には載らない
          // (ENGINE-trigger-cause-self-state-based-exclude, 2026-06-23)。
          cause: ["opponent_effect", "battle", "state_based"],
        },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        limitGroupId: "BSES01-R03-leave-reward",
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
        textRef: [9, 10],
      },
    ],
  },
  {
    cardNo: "BSES01-T01",
    orikaId: 395,
    orikaIndex: 425,
    name: "M1A4 ジャガーノート",
    printedCategory: "spirit",
    colors: ["white"],
    cost: 0,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 4000,
      },
    ],
    symbolColors: [],
    textLines: [
      "このカードはデッキに入れられない。",
      "",
      "〔重複不可〕トークンデッキにあるこのカードは、自分が系統：「８６」を持つブレイヴを召喚するとき、召喚コスト支払い前に出し、対象はこのスピリットに直接合体しなければならない。このとき、このスピリットのコアは、トラッシュからも《ソウルコア》以外のコアを1個まで置ける。",
      "",
      "このスピリットのブレイヴは分離できず、このスピリットがフィールドを離れるとき、フィールドに残せない。",
      "",
      "Lv1『このスピリットのアタック/ブロック時』",
      "このスピリットの合体中、系統：「指揮官」を持つ自分の導界者ネクサスにコア+1できる。",
    ],
    keywordTags: ["token"],
    tribe: "動器",
    image: "images/BSES01-T01.webp",
    rarity: "T",
    pack: "BSES01 ８６-エイティシックス-",
    maxTokenDeckCount: 9,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: "token_pool" },
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          beforeCost: true,
          triggerFilter: { category: ["brave"], tribes: ["８６"] },
        },
        usageLimit: { kind: "no_duplicate" },
        steps: [
          {
            action: {
              kind: "put",
              target: { kind: "from_token_pool", source: "self", count: 1 },
              costModifier: "free",
              trashCoreMax: 1,
              trashCoreKind: "normal",
              requireDirectCombineWithTrigger: true,
            },
          },
        ],
        textRef: [2],
      },
      // [4] このスピリットのブレイヴは分離できず、このスピリットがフィールドを離れるとき、フィールドに残せない。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "prevent_brave_separation",
              target: { kind: "self" },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4],
      },
      // [6,7] Lv1『このスピリットのアタック/ブロック時』
      //   このスピリットの合体中、系統:「指揮官」を持つ自分の導界者ネクサスにコア+1できる。
      //   condition: 合体中(combined=true) + core_move to field_card(指揮官+導界者ネクサス)。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        condition: [{ kind: "combined" }],
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "core_move",
              // 「コア+1」= ボイドからカード上にコア1個を置く。神託の core+1 同型
              // (oracle-system.ts executeOracleCorePlacement)。
              from: { kind: "void", player: "self" },
              // 原文「導界者ネクサス」= guided 限定 (= 通常ネクサス・転醒ネクサス・創界神ネクサスを除外)。
              // targetsGrandwalker:"only" + hasMechanic:["guided"] で creator/grandstone も除外して
              // guided ネクサスのみ通す (creator:'grandwalker' は targetsGrandwalker:"only" を満たすが
              // hasMechanic:["guided"] で弾かれる)。convertCoreLocation の filter allowlist は
              // hasMechanic を含めて全 CardFilter フィールドをそのまま通す (effect-interpreter.ts L3756)。
              // verifier 2026-06-23 round 7 lens 1 補正。
              to: {
                kind: "field_card",
                player: "self",
                filter: {
                  category: ["nexus"],
                  tribes: ["指揮官"],
                  targetsGrandwalker: "only",
                  hasMechanic: ["guided"],
                },
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
    cardNo: "BSES01-X01",
    combinedBoost: 4000,
    orikaId: 409,
    orikaIndex: 426,
    name: "[葬儀屋]シンエイ・ノウゼン",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "スピリット状態のこのブレイヴはアタック/ブロックできない。",
      "",
      "フラッシュ『お互いのアタックステップ』",
      "手札/手元にあるこのカードはコスト2として召喚できる。",
      "",
      "【合体条件：「ジャガーノート」】",
      "【合体中】【行きつく果てまで】",
      "自分のトラッシュにあるブレイヴカードの数により、以下の効果を発揮する。",
      "1枚以上:対象のカード1枚につき、このスピリットをBP+1000する。",
      "4枚以上:このスピリットのアタック/ブロック中、ターンに1回、フラッシュタイミングでこのスピリットのBP以下の相手のスピリット/アルティメット1体を破壊できる。",
      "8枚以上:このスピリットのバトル終了時、ターンに1回このスピリットは回復できる。",
    ],
    keywordTags: [],
    tribe: "８６",
    image: "images/BSES01-X01.webp",
    rarity: "X",
    pack: "BSES01 ８６-エイティシックス-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    relatedTokenCardNos: ["BSES01-T01"],
    braveCondition: { cardNameContains: ["ジャガーノート"] },
    effects: [
      // [0] スピリット状態のこのブレイヴはアタック/ブロックできない。needs-dsl.w1.jsonl。
      {
        // スピリット状態(非合体)のこのブレイヴはアタック/ブロックできない。
        // applicability.combined=false で「スピリット状態(=合体していない)」に限定し、
        // 合体中(host へ attach 済み)は CE が外れる。
        timing: { kind: "continuous" },
        applicability: { combined: false },
        steps: [
          {
            action: {
              kind: "prevent_battle",
              target: { kind: "self" },
              restriction: ["attack", "block"],
              duration: { scope: "permanent" },
              ruleStrength: true,
            },
          },
        ],
        textRef: [0],
      },
      // [2,3] フラッシュ『お互いのアタックステップ』手札/手元のこのカードはコスト2として召喚できる。needs-dsl.w1.jsonl。
      {
        applicability: {
          zone: ["hand", "set_aside"],
        },
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
        textRef: [2, 3],
      },
      // [5,6,7,8] 【合体中】【行きつく果てまで】1枚以上:自分のトラッシュのブレイヴカード1枚につき このスピリットをBP+1000。
      {
        applicability: { combined: true },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "bp_modify",
              target: { kind: "self" },
              amount: {
                source: {
                  kind: "cards_in_zone",
                  zone: "trash",
                  player: "self",
                  filter: { category: ["brave"] },
                },
                multiplier: 1000,
              },
              duration: { scope: "permanent" },
            },
          },
        ],
        textRef: [5, 6, 7, 8],
      },
      // [9] 【行きつく果てまで】4枚以上: このスピリットのアタック/ブロック中、ターンに1回、
      // フラッシュタイミングでこのスピリットのBP以下の相手スピリット/アルティメット1体を破壊できる。
      // 発揮条件: トラッシュのブレイヴ枚数 >= 4 (cards_in_zone) ∧ 自身がアタック/ブロック中
      // (in_battle、state 省略 = attacking or blocking)。動的 BP 比較は
      // maxBpSource: "self_effective_bp"（BSTH08.5-R11 と同型、resolveSelfBpThreshold）。
      {
        applicability: { combined: true },
        timing: { kind: "activated", mode: "flash" },
        activationLabel: "none",
        condition: [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "trash",
            filter: { category: ["brave"] },
            min: 4,
          },
          { kind: "in_battle" },
        ],
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        executionMode: "optional",
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
        textRef: [9],
      },
      // [10] 【行きつく果てまで】8枚以上: バトル終了時ターンに1回このスピリットは回復できる。
      // トラッシュのブレイヴ枚数閾値は cards_in_zone condition (min:8) で判定。
      {
        applicability: { combined: true },
        timing: { kind: "card_event", event: "battle_end" },
        condition: [
          {
            kind: "cards_in_zone",
            player: "self",
            zone: "trash",
            filter: { category: ["brave"] },
            min: 8,
          },
        ],
        usageLimit: { kind: "per_instance", duration: "turn", maxCount: 1 },
        executionMode: "optional",
        steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
        textRef: [10],
      },
    ],
  },
];
