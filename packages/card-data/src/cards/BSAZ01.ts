import type { CardDefinition } from "@orica/rules-core";

export const BSAZ01_CARDS: CardDefinition[] = [
  {
    cardNo: "BSAZ01-C01",
    orikaId: 5,
    orikaIndex: 317,
    name: "KG-6 スレイプニール",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
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
    symbolColors: ["yellow"],
    textLines: [
      "〔ターンに1回：同名〕トラッシュにあるこのカードは、フィールドで、スピリットとしているものとして自分の「スレイプニール」を【煌臨】できる。",
      "このとき、【煌臨】するカードにフィールド/リザーブのコアを好きなだけ置く。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から1枚ドローできる。このスピリットの合体中、ドロー枚数を+1する。",
      "",
      "Lv1-Lv2『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体をBP-2000でき、BP0になったスピリット/アルティメットを破壊する。",
    ],
    keywordTags: ["advent"],
    tribe: "地球・ＣＦ",
    image: "images/BSAZ01-C01.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『召喚時』デッキ1ドロー（できる）。合体中なら同じ発揮内で強制+1。
      {
        timing: { kind: "card_event", event: "summon" },
        executionMode: "optional",
        steps: [
          {
            // 枚数+1は別ドローではない。対価・手札増加イベントも合計2枚で1回。
            action: {
              kind: "draw",
              count: {
                source: { kind: "braves_on_source" },
                offset: 1,
                cap: 2,
              },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2『アタック時』相手のスピリット/アルティメット1体をBP-2000→BP0破壊。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
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
              amount: -2000,
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

    trashAdventHostGrant: {
      cardNames: [{ contains: "スレイプニール" }],
      chargeCoresOnAdvent: true,
    },
  },
  {
    cardNo: "BSAZ01-C02",
    orikaId: 307,
    orikaIndex: 318,
    name: "KG-6 スレイプニール［宇宙装備］",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 3000,
      },
      {
        level: 2,
        requiredCores: 4,
        bp: 6000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "〔ターンに1回：同名〕トラッシュにあるこのカードは、フィールドで、スピリットとしているものとして自分の「スレイプニール」を【煌臨】できる。このとき、煌臨するカードにフィールド/リザーブのコアを好きなだけ置く。",
      "",
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から4枚オープンでき、その中の系統：「地球」を持つブレイヴカード/ネクサスカード/マジックカード1枚を手札に加える。残ったカードは破棄する。",
      "",
      "Lv1-Lv2『このスピリットのアタック/ブロック時』",
      "相手のスピリット/アルティメット1体をBP-3000でき、BP0になったスピリット/アルティメットを破壊する。このスピリットの合体中、追加で1回この効果を発揮できる。",
    ],
    keywordTags: ["advent"],
    tribe: "地球・ＣＦ",
    image: "images/BSAZ01-C02.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『召喚時』デッキ4枚オープン→地球ブレイヴ/ネクサス/マジック1枚を手札、残り破棄。
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
              revealCount: 4,
              picks: [
                {
                  count: 1,
                  filter: {
                    tribes: ["地球"],
                    category: ["brave", "nexus", "magic"],
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
      // Lv1-Lv2『アタック時』相手1体をBP-3000→BP0破壊。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
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
              amount: -3000,
              duration: { scope: "turn" },
            },
            repeat: {
              additional: 1,
              optional: true,
              condition: [{ kind: "combined" }],
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
      // Lv1-Lv2『ブロック時』相手1体をBP-3000→BP0破壊。
      {
        timing: { kind: "card_event", event: "block" },
        executionMode: "optional",
        steps: [
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
              amount: -3000,
              duration: { scope: "turn" },
            },
            repeat: {
              additional: 1,
              optional: true,
              condition: [{ kind: "combined" }],
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

    trashAdventHostGrant: {
      cardNames: [{ contains: "スレイプニール" }],
      chargeCoresOnAdvent: true,
    },
  },
  {
    cardNo: "BSAZ01-C03",
    orikaId: 308,
    orikaIndex: 319,
    name: "いつか見た流星",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: ["yellow", "yellow", "yellow", "white", "white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕手札にあるこのカードは、自分のスピリット/アルティメットがフィールドを離れるとき、コストを支払わずに使用できる。",
      "",
      "フラッシュ",
      "自分の手札/手元/フィールドのカード13枚までを除外することで、除外した枚数により以下の効果を発揮する。この効果は、スタックタイミングで発揮されない。",
      "",
      "2枚以上：このバトル終了時、相手のアタックステップを終了する。",
      "",
      "3枚以上：フィールドを離れるスピリット/アルティメットを疲労状態でフィールドに残す。",
      "",
      "10枚以上：相手のスピリット/アルティメットすべてを破壊する。",
      "",
      "13枚以上：［ゲームに1回：同名］相手のターンを終了する。その後、自分のデッキを1枚になるように破棄することで、相手は次のターンを行えない。",
    ],
    keywordTags: [],
    tribe: "地球・火星",
    image: "images/BSAZ01-C03.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0]〔ターンに1回：同名〕手札にあるこのカードは、自分のスピリット/アルティメットが
      //   フィールドを離れるとき、コストを支払わずに使用できる。原文に「相手によって」の
      //   限定が無いため cause は指定しない (BSAZ02-M04[0] 同型の裁定慣例)。
      //   conditional-free-magic-use-on-event (BSAZ02-C15[0] 同型)。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: { category: ["spirit", "ultimate"] },
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        steps: [
          { action: { kind: "use_magic_without_cost", magicTiming: "flash" } },
        ],
        textRef: [0],
      },
      // [2,3,5,7,9] フラッシュ: 自分の手札/手元/フィールドのカード13枚までを除外し、除外枚数の
      //   閾値により段階効果を発揮する。「スタックタイミングで発揮されない」は mode:"flash"
      //   単独登録 (BSAZ01-C07/C10 既存コメント参照) で構造的に満たされるため追加実装不要。
      //   除外は TargetSpec.kind:"filter" の zone: Zone[] (複数ゾーン合算候補プール、
      //   BSAZ02-TX01(B) 同型) + count:{min:0,max:13} (0..N 任意選択、BSLH01-M03[destroy exclude]
      //   同型) を hand/set_aside/field の3ゾーンへ拡張した組み合わせで表現する
      //   (collectTargetCardCandidates は target.zone.includes(c.zone) の単純メンバーシップ判定
      //   のため異種ゾーン混在も既存コードで正しく合算される。新規プリミティブ不要)。
      //   除外実枚数は ref_count (既定 result:"affected"、BSAZ01-C05 destroy-battlers 同型) で
      //   後続 step を閾値ゲートする。
      //   2枚以上: このバトル終了時、相手のアタックステップを終了する
      //   (deferTo:"battle_end"+end_attack_step、BSSG01-C0x 同型)。
      //   3枚以上: フィールドを離れるスピリット/アルティメットを疲労状態でフィールドに残す
      //   (stay_on_field(trigger_related_instance)、ENGINE-leave-field-free-use-stay-on-field-flush-gate
      //   解消。詳細は下の step コメント参照)。
      //   10枚以上: 相手のスピリット/アルティメットすべてを破壊する (destroy count:"all")。
      //   13枚以上 (相手ターン終了+デッキ1枚化) は下記 stub 参照。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "exclude-cards",
            action: {
              kind: "remove_from_game",
              target: {
                kind: "filter",
                player: "self",
                zone: ["hand", "set_aside", "field"],
                filter: {},
                count: { min: 0, max: 13 },
              },
            },
          },
          {
            id: "destroy-opponent-field",
            connector: "conditional_cost",
            conditionalCostAlternativeStepIds: [
              "stay-leaving-card",
              "end-opponent-turn",
              "skip-opponent-turn",
              "end-opponent-attack-step",
            ],
            stepCondition: {
              kind: "ref_count",
              stepId: "exclude-cards",
              min: 10,
            },
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit", "ultimate"] },
                count: "all",
              },
            },
          },
          // 3枚以上「フィールドを離れるスピリット/アルティメットを疲労状態でフィールドに残す」:
          // stay_on_field(trigger_related_instance) は第三者 game_event(leave_field) 観測からの
          // 残置として BSLH01-C06 等で実証済みだが、本カードは無償使用トリガー(effects[0]、
          // steps:[use_magic_without_cost]のみ)と本 flash 本体が別 effectIndex に分かれている。
          // trigger-system.ts getRegisteredLeaveFieldStayOnFieldSourceKeys を
          // ENGINE-leave-field-free-use-stay-on-field-flush-gate で拡張し、登録された trigger
          // effect (use_magic_without_cost) の sibling activated effect (=この flash 本体) が
          // trigger_related_instance 付き stay_on_field/rebirth を持つ場合も flush-gate 対象に
          // 含めた。実行時は magic-system.ts の triggerRelatedInstanceId 引き継ぎ
          // (native-action-registry.ts use_magic_without_cost ハンドラ →
          // resolveMagicMainAndMoveToTrash) により、この別 effectIndex からでも離脱した
          // スピリット/アルティメット自身を trigger_related_instance で参照できる。
          {
            id: "stay-leaving-card",
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "exclude-cards",
              min: 3,
            },
            action: {
              kind: "stay_on_field",
              target: {
                kind: "trigger_related_instance",
                includePendingLeave: true,
              },
              newExhaustState: "exhausted",
            },
          },
          // 13枚以上「［ゲームに1回：同名］相手のターンを終了する。その後、自分のデッキを
          //   1枚になるように破棄することで、相手は次のターンを行えない」:
          //   ENGINE-opponent-turn-skip (cluster engine-bsaz01-c03-opponent-turn-skip)。
          //   「相手のターンを終了する」は文字どおり「現在進行中の相手のターン」を前提にする
          //   (adversarial verifier round1 lens1 指摘: end_turn は player を持たず現在アクティブな
          //   ターンを無条件終了するため、自分のターン中にこの枝を発揮すると自分のターンを
          //   終了させてしまう誤り。sibling「2枚以上」end_attack_step は deferTo:"battle_end"
          //   で挙動が別カテゴリのため precedent にならない)。
          //   裁定(needs-ruling.jsonl BSAZ01-C03、2026-08-04、案B採用): 「その後」は因果依存では
          //   なく独立した段階効果として読む([[project_prevent_scoped_idiom_no_branch]]の
          //   「分岐挙動なし」に近い読み方)。end_turn だけを
          //   condition:[{kind:"turn_player", player:"opponent"}] でゲートし、discard/
          //   skip_next_turn は無条件で発揮する。
          //   「ゲームに1回:同名」は3 step 独立 usageLimit だと、自分ターン活性化で discard/
          //   skip_next_turn だけ消費され、後の相手ターン活性化で end_turn だけ発揮される
          //   分裂使用状態が起こり得る(ユーザー指摘)。usageLimit の消費主体を専用 gate step
          //   (usage-gate-13、noop+target:{kind:"ref",stepId:"exclude-cards"}) 1つへ集約し、
          //   3 action step は stepCondition:{kind:"ref_succeeded", stepId:"usage-gate-13"} で
          //   gate の成否だけを見る(ENGINE-brave-combine-third-party-target の noop+target
          //   選択専用 step precedent と同型、専用 Effect フィールド不要)。target を
          //   {kind:"self"}にすると target-resolution.ts の self 解決が zone==="field" 限定
          //   (マジック解決中は zone:"in_use") で常に空になるため使えない
          //   (structured-effect-interpreter.ts 側の self 解決は in_use/set_aside も許容し
          //   矛盾がある、既存の SSOT ギャップ)。代わりに ref(exclude-cards) を target にすれば、
          //   gate 到達時点で必ず13枚以上が非空で resolve 済みのため zone に依存せず安全に
          //   「成功」を記録できる。gate は ref_count>=13 を満たしたときだけ usageLimit を
          //   消費して noop を成功させるため、「一度でも13枚以上除外して発揮」した時点で
          //   ゲーム中1回を使い切り、end_turn 単独の後出しは起こらない。
          //   「自分のデッキを1枚になるように破棄する」= 既存 discard(fromZone:"deck",
          //   targetHandSize:1) — targetHandSize は名前に反し対象ゾーン総数(ここではデッキ
          //   枚数)に対する「N枚になるまで破棄」を汎用的に表す(structured-zone-ops.ts
          //   effectiveCount、isDeckMill 経由で既存 BSKB01 系ミル破棄と同じ経路)。新規表現不要。
          //   「相手は次のターンを行えない」= 新設 skip_next_turn primitive
          //   (dsl-types.ts DSL.SkipNextTurnAction)。追加ターンとは異なり、
          //   「相手の現ターンを今すぐ終了させつつ、相手の次の巡ってくる番も飛ばす」。
          //   対象プレイヤーIDを GameState.pendingTurnSkips に予約し、
          //   end→start 遷移 (turn-system.ts advanceFromEndStep) 側で消費する。
          {
            id: "usage-gate-13",
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "exclude-cards",
              min: 13,
            },
            usageLimit: { kind: "per_card_name", duration: "game" },
            action: {
              kind: "noop",
              target: { kind: "ref", stepId: "exclude-cards" },
            },
          },
          {
            id: "end-opponent-turn",
            connector: "sequential",
            condition: [{ kind: "turn_player", player: "opponent" }],
            stepCondition: { kind: "ref_succeeded", stepId: "usage-gate-13" },
            action: { kind: "end_turn" },
          },
          {
            id: "discard-for-skip",
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "usage-gate-13" },
            executionMode: "optional",
            action: {
              kind: "discard",
              player: "self",
              count: -1,
              fromZone: "deck",
              targetHandSize: 1,
            },
          },
          {
            id: "skip-opponent-turn",
            connector: "conditional_cost",
            stepCondition: { kind: "ref_succeeded", stepId: "usage-gate-13" },
            action: { kind: "skip_next_turn", player: "opponent" },
          },
          {
            id: "end-opponent-attack-step",
            // deferTo:"battle_end" は到達した step 以降を丸ごとバトル終了時へ退避する
            // (resumeFromStepIndex、dsl-types.ts EffectStep.deferTo JSDoc)。10枚以上枝
            // (destroy, 即時実行が必要)・3枚以上枝 (stay_on_field, 即時実行が必要)・13枚以上枝
            // (end_turn 等, 即時実行が必要) より後ろに置かないと即時実行が巻き込まれて
            // バトル終了まで遅延してしまうため、この step を steps 配列の最後に置く。
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "exclude-cards",
              min: 2,
            },
            action: { kind: "end_attack_step" },
            deferTo: "battle_end",
          },
        ],
        textRef: [2, 3, 5, 7, 9, 11],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C04",
    orikaId: 309,
    orikaIndex: 320,
    name: "アセイラム姫暗殺計画",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分のフィールドのマジックカード1枚につき、このカードの軽減シンボル1つを満たす。",
      "",
      "フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "■お互いのアタックステップ中、このカードは、フラッシュ効果を使用できる。",
      "",
      "メイン",
      "自分のデッキを上から3枚破棄する。",
      "",
      "フラッシュ",
      "魂状態/合体中を含む自分の「界塚伊奈帆」がいるとき、自分のターンなら、相手のネクサス/創界神ネクサス1つを破壊する。この効果は、スタックタイミングで発揮されない。",
    ],
    keywordTags: ["soul_state", "operation"],
    tribe: "地球",
    image: "images/BSAZ01-C04.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [2] フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く（強制）。
      //   engine-field-magic-self-placement: BSES01-C01[4,5] の optional 自己配置(自分自身の
      //   フラッシュ解決トレイリングステップ)と異なり、こちらは ANY trash 行き(discard/destroy等)
      //   で発火する card_event(moved_to_trash) トリガー。「フラッシュ効果使用後」(=自分の
      //   フラッシュ解決による通常トラッシュ確定)だけを除外するため、flash_used(target:
      //   "card_usage", negate:true, cardFilter:cardNames exact) で自分自身のカード使用履歴を
      //   参照する（裁定源: 10_rules/07b_card-observed-mechanics.md §6 タイプ：作戦）。
      //   move_self は card_event の steps からも cardEventDisposition 推論経由で動作する
      //   (findMovedToTrashAutoEffect の新設 "move_to_field" kind、structured-trash-ops.ts)。
      //   cardFilter.cardName の exact 名指定に加え、sameInstanceAsSource で「このカード」
      //   自身の使用履歴だけを参照する（同名別 instance の使用では自己配置を妨げない）。
      {
        timing: { kind: "card_event", event: ["moved_to_trash"] },
        executionMode: "mandatory",
        condition: [
          {
            kind: "flash_used",
            target: "card_usage",
            scope: "step",
            player: "self",
            cardFilter: { cardName: { exact: "アセイラム姫暗殺計画" } },
            sameInstanceAsSource: true,
            negate: true,
          },
        ],
        cardEventDisposition: { kind: "move", destination: "field" },
        steps: [{ action: { kind: "move_self", destination: "field" } }],
        textRef: [2],
      },
      // [0] 使用時に印字済み軽減枠を充足: 自分のフィールドのマジックカード1枚につき黄1つ。
      //   BSAZ01-C07[0]/C08[0]/C10[0] と同型 (treat_as reduction_symbol + DynamicCount
      //   cards_in_zone、engine-field-magic-self-placement)。
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
        ],
        textRef: [0],
      },
      // [7,8] メイン: 自分のデッキを上から3枚破棄する。
      //   BSFT01-TR13(A)[4,5] と同型 (deck_reveal revealCount:3 + picks:[] + remainder:"trash"
      //   = リビール無しの単純ミル)。
      {
        timing: {
          kind: "activated",
          mode: "main",
        },
        steps: [
          {
            action: {
              kind: "discard",
              player: "self",
              fromZone: "deck",
              count: 3,
            },
          },
        ],
        textRef: [7, 8],
      },
      // [10,11] フラッシュ: 魂状態/合体中を含む自分の「界塚伊奈帆」がいるとき、自分のターンなら、
      //   相手のネクサス/創界神ネクサス1つを破壊する。
      //   field_has(includeSoulState:true, cardNames contains) で「魂状態/合体中を含む」を表現
      //   (合体中のカードは通常フィールドインスタンスのため無印スコープで既に包含、魂状態のみ
      //   opt-in が必要。10_rules/08a 裁定 2026-06-13 + BSAZ03-C01[2,3] 同型)。
      //   「相手のネクサス/創界神ネクサス」= targetsGrandwalker:true (BSDB01-R01[7,8] 同型)。
      //   「この効果は、スタックタイミングで発揮されない」は mode:"flash" 単独登録
      //   (stack 応答窓では legal action にならない、BSAZ01-C07[10,11] 同型) で既に満たされる。
      {
        timing: { kind: "activated", mode: "flash" },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "界塚伊奈帆" }],
            includeSoulState: true,
          },
          { kind: "turn_player", player: "self" },
        ],
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"], targetsGrandwalker: true },
                count: 1,
              },
            },
          },
        ],
        textRef: [10, 11],
      },
      // 【タイプ：作戦】常時効果で、指定窓の通常マジック使用を場からも許可する。
      {
        applicability: { zone: "field" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_magic_use",
              timing: "flash",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C05",
    orikaId: 310,
    orikaIndex: 321,
    name: "邂逅と決別",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 5,
    reductionSymbols: ["yellow", "yellow", "white", "white"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕手札にあるこのカードは、自分のスピリット/アルティメットがブロックした/されたとき、コストを支払わずに使用できる。",
      "",
      "フラッシュ",
      "バトルしているスピリット/アルティメット2体を破壊する。そうしたとき、自分は相手の手札を、相手は自分の手札を、それぞれ内容を見ないで1枚破棄する。これらの効果は、スタックタイミングで発揮されない。",
    ],
    keywordTags: [],
    tribe: "地球・火星",
    image: "images/BSAZ01-C05.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // [0] 自分のスピリット/アルティメットがブロックしたとき、手札からコスト不要使用。
        // queueBattleDeclarationTriggers の block event は宣言したブロッカーを relatedInstanceId
        // に持つため、triggerFilter で自分の blocker に限定する。
        timing: {
          kind: "game_event",
          player: "self",
          event: "block",
          triggerFilter: { category: ["spirit", "ultimate"] },
        },
        applicability: { zone: "hand" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "BSAZ01-C05-free-use",
        steps: [
          { action: { kind: "use_magic_without_cost", magicTiming: "flash" } },
        ],
        textRef: [0],
      },
      {
        // [0] 自分のスピリット/アルティメットがブロックされたとき、手札からコスト不要使用。
        // block event の relatedInstanceId は相手ブロッカーなので、player:"opponent" と
        // 自分の攻撃中カード条件で「ブロックされた」を表す。
        timing: {
          kind: "game_event",
          player: "opponent",
          event: "block",
          triggerFilter: { category: ["spirit", "ultimate"] },
        },
        condition: [
          {
            kind: "field_has",
            player: "self",
            minCount: 1,
            category: ["spirit", "ultimate"],
            battleState: "attacking",
          },
        ],
        applicability: { zone: "hand" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn" },
        limitGroupId: "BSAZ01-C05-free-use",
        steps: [
          { action: { kind: "use_magic_without_cost", magicTiming: "flash" } },
        ],
        textRef: [0],
      },
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            id: "destroy-battlers",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "either",
                filter: {
                  category: ["spirit", "ultimate"],
                  battleState: "in_battle",
                },
                count: 2,
              },
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "destroy-battlers",
              min: 2,
            },
            action: {
              kind: "discard",
              player: "opponent",
              count: 1,
              unseen: true,
            },
          },
          {
            connector: "sequential",
            stepCondition: {
              kind: "ref_count",
              stepId: "destroy-battlers",
              min: 2,
            },
            action: { kind: "discard", player: "self", count: 1, unseen: true },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C06",
    orikaId: 311,
    orikaIndex: 322,
    name: "出撃",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "〔ターンに1回：同名〕トラッシュにあるこのカードは、自分のブレイヴ/ネクサスが相手によってフィールドを離れたとき、手札に戻せる。",
      "",
      "このカードのコストを支払うとき、自分のフィールドのマジックカードをデッキの下に戻すことで、戻した枚数1枚につき、1コスト支払ったものとして扱う。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "■お互いのアタックステップ中、このカードは、フラッシュ効果を使用できる。",
      "",
      "フラッシュ",
      "自分の手札の「スレイプニール」1枚をコストを支払わずに召喚する。この効果は、スタックタイミングで発揮されない。",
    ],
    keywordTags: ["operation"],
    tribe: "地球",
    image: "images/BSAZ01-C06.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        applicability: { zone: "field" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_magic_use",
              timing: "flash",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        applicability: {
          zone: ["trash"],
        },
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          exactEventKind: true,
          triggerFilter: {
            category: ["brave", "nexus"],
          },
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
        steps: [
          {
            action: {
              kind: "move_card",
              target: {
                kind: "self",
              },
              from: {
                zone: "trash",
                player: "self",
              },
              to: {
                zone: "hand",
              },
              count: 1,
              requireFullCount: true,
            },
          },
        ],
        textRef: [0],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "cost_modify",
              target: {
                kind: "self",
              },
              modifier: {
                additionalCostValue: -1,
              },
              useCostPayment: {
                kind: "return_to_deck_bottom_field",
                sourceZone: "field",
                maxCount: 3,
                filter: {
                  category: ["magic"],
                },
              },
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  cardName: [
                    {
                      contains: "スレイプニール",
                    },
                  ],
                },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C07",
    orikaId: 312,
    orikaIndex: 323,
    name: "巻き添え自爆",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分のフィールドのマジックカード1枚につき、このカードの軽減シンボル1つを満たす。",
      "",
      "フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "■お互いのアタックステップ中、このカードは、フラッシュ効果を使用できる。",
      "",
      "メイン",
      "手札/トラッシュの「スレイプニール」1枚をコストを支払わずに召喚する。",
      "",
      "フラッシュ",
      "自分のスピリット1体を破壊することで、相手のスピリット/アルティメット1体を破壊する。この効果は、スタックタイミングで発揮されない。",
    ],
    keywordTags: ["operation"],
    tribe: "地球",
    image: "images/BSAZ01-C07.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [2] フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く（強制）。
      //   BSAZ01-C04[2] と同型 (engine-field-magic-self-placement)。
      {
        timing: { kind: "card_event", event: ["moved_to_trash"] },
        executionMode: "mandatory",
        condition: [
          {
            kind: "flash_used",
            target: "card_usage",
            scope: "step",
            player: "self",
            cardFilter: { cardName: { exact: "巻き添え自爆" } },
            sameInstanceAsSource: true,
            negate: true,
          },
        ],
        cardEventDisposition: { kind: "move", destination: "field" },
        steps: [{ action: { kind: "move_self", destination: "field" } }],
        textRef: [2],
      },
      // [0] 使用時に印字済み軽減枠を充足: 自分のフィールドのマジックカード1枚につき黄1つ。
      //   BSAZ01-C10[1] と同型 (treat_as reduction_symbol + DynamicCount cards_in_zone,
      //   engine-field-magic-self-placement)。
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
        ],
        textRef: [0],
      },
      // [7,8] メイン: 手札/トラッシュの「スレイプニール」1枚をコストを支払わずに召喚する。
      //   通常の手札使用(コスト支払い後の メイン/フラッシュ 選択の一方)。ENGINE-from-zone-summon
      //   -target-selection (BSFT01-C04[5,6] 同型) の target:{kind:"from_zone"}+filter.cardName
      //   (「」=部分一致) + costModifier:"free" で表現。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  cardName: [{ contains: "スレイプニール" }],
                },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [7, 8],
      },
      // [10,11] フラッシュ: 自分のスピリット1体を破壊することで、相手のスピリット/アルティメット
      //   1体を破壊する（conditional_cost「ことで構文」、BSGE01-C05 の discard→draw と同型）。
      //   「この効果は、スタックタイミングで発揮されない」は新規制約ではなく、mode:"flash" 登録が
      //   スタック応答窓(pendingStackAction!==null)では構造的に legal action にならないこと
      //   (getResponseWindowActionTimings が "stack" のみ返す、stack-window-shared.ts) で
      //   既に満たされる。通常の手札使用登録 (generateMagicRegistrations, applicability 省略)。
      {
        executionMode: "optional",
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
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
            connector: "conditional_cost",
          },
        ],
        textRef: [10, 11],
      },
      // 【タイプ：作戦】常時効果で、指定窓の通常マジック使用を場からも許可する。
      {
        applicability: { zone: "field" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_magic_use",
              timing: "flash",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C08",
    orikaId: 313,
    orikaIndex: 324,
    name: "間隙強襲",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分のフィールドのマジックカード1枚につき、このカードの軽減シンボル1つを満たす。",
      "",
      "スタック効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "■お互いのアタックステップ中、このカードは、スタック効果を使用できる。",
      "",
      "メイン",
      "手札/トラッシュの「スレイプニール」1枚をコストを支払わずに召喚する。",
      "",
      "スタック",
      "次のバトル終了後まで、自分の合体スピリット1体は、相手の効果を受けない。この効果は、お互いのアタックステップしか発揮されない。",
    ],
    keywordTags: ["operation"],
    tribe: "地球",
    image: "images/BSAZ01-C08.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [2] スタック効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く（強制）。
      //   BSAZ01-C04[2] と同型 (engine-field-magic-self-placement)。C08/C09 は
      //   【タイプ：作戦】がスタック窓を開くため、flash_used の mode:"stack" で
      //   「スタック効果使用後」を判定する（C04/C07/C10/C11 は mode 省略=flash）。
      {
        timing: { kind: "card_event", event: ["moved_to_trash"] },
        executionMode: "mandatory",
        condition: [
          {
            kind: "flash_used",
            target: "card_usage",
            scope: "step",
            player: "self",
            mode: "stack",
            cardFilter: { cardName: { exact: "間隙強襲" } },
            sameInstanceAsSource: true,
            negate: true,
          },
        ],
        cardEventDisposition: { kind: "move", destination: "field" },
        steps: [{ action: { kind: "move_self", destination: "field" } }],
        textRef: [2],
      },
      // [0] 使用時に印字済み軽減枠を充足: 自分のフィールドのマジックカード1枚につき黄1つ。
      //   BSAZ01-C07[0]/C10[0] と同型 (treat_as reduction_symbol + DynamicCount cards_in_zone,
      //   engine-field-magic-self-placement)。
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
        ],
        textRef: [0],
      },
      // [7,8] メイン: 手札/トラッシュの「スレイプニール」1枚をコストを支払わずに召喚する。
      //   BSAZ01-C07[7,8] と同型 (from_zone hand/trash + costModifier:"free")。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "summon",
              target: {
                kind: "from_zone",
                zone: ["hand", "trash"],
                filter: {
                  category: ["spirit", "ultimate", "brave"],
                  cardName: [{ contains: "スレイプニール" }],
                },
                count: 1,
              },
              costModifier: "free",
            },
          },
        ],
        textRef: [7, 8],
      },
      // [10,11] スタック: 次のバトル終了後まで、自分の合体スピリット1体は、相手の効果を
      //   受けない。BSFT01-TR02(A)[4,5] と同型 (effect_immunity + duration:{scope:"battle"}、
      //   「次のバトル終了後まで」= battle スコープ近似。engine-field-magic-self-placement)。
      //   「この効果は、お互いのアタックステップしか発揮されない」は timingScope で表現
      //   （通常の手札からのスタック使用登録、mode:"stack" は generateMagicRegistrations 経由）。
      {
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"], combined: true },
                count: 1,
              },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [10, 11],
      },
      // 【タイプ：作戦】常時効果で、指定窓の通常マジック使用を場からも許可する。
      {
        applicability: { zone: "field" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_magic_use",
              timing: "stack",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4, 5],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C09",
    orikaId: 314,
    orikaIndex: 325,
    name: "煙幕阻害",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分のフィールドのマジックカード1枚につき、このカードの軽減シンボル1つを満たす。",
      "",
      "スタック効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "■お互いのアタックステップ中、このカードは、スタック効果を使用できる。",
      "",
      "スタック",
      "〔アタックステップ〕系統：「地球」と「ＣＦ」を持つ自分のスピリットがいるとき、このターンの間、相手は、アタック/ブロックする相手のスピリット/アルティメットから1コスト支払わなければアタック/ブロックできない。さらに、お互いは「ブロックされない」スピリット/アルティメットをブロックできる。",
    ],
    keywordTags: ["operation"],
    tribe: "地球",
    image: "images/BSAZ01-C09.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["moved_to_trash"],
        },
        executionMode: "mandatory",
        condition: [
          {
            kind: "flash_used",
            target: "card_usage",
            scope: "step",
            player: "self",
            mode: "stack",
            cardFilter: {
              cardName: {
                exact: "煙幕阻害",
              },
            },
            sameInstanceAsSource: true,
            negate: true,
          },
        ],
        cardEventDisposition: {
          kind: "move",
          destination: "field",
        },
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "field",
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
              waivesReductionRequirement: true,
              count: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: {
                    category: ["magic"],
                  },
                },
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        applicability: { zone: "field" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_magic_use",
              timing: "stack",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4, 5],
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
        condition: [
          {
            kind: "field_has",
            player: "self",
            category: ["spirit"],
            tribesRequired: ["地球", "ＣＦ"],
          },
        ],
        steps: [
          {
            action: {
              kind: "require_battle_cost",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: "all",
              },
              restriction: ["attack", "block"],
              costAmount: 1,
              duration: {
                scope: "turn",
              },
            },
          },
          {
            action: {
              kind: "block_unblockable",
              target: {
                kind: "filter",
                player: "either",
                filter: {
                  category: ["spirit", "ultimate"],
                },
                count: "all",
              },
              duration: {
                scope: "turn",
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C10",
    orikaId: 315,
    orikaIndex: 326,
    name: "戦闘降下強襲",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分のフィールドのマジックカード1枚につき、このカードの軽減シンボル1つを満たす。",
      "",
      "フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "■お互いのアタックステップ中、このカードは、フラッシュ効果を使用できる。",
      "",
      "フラッシュ",
      "このターンの間、系統：「地球」と「ＣＦ」を持つ自分のスピリットすべては、ブロックされない。この効果は、スタックタイミングで発揮されない。",
    ],
    keywordTags: ["operation"],
    tribe: "地球",
    image: "images/BSAZ01-C10.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["moved_to_trash"],
        },
        executionMode: "mandatory",
        condition: [
          {
            kind: "flash_used",
            target: "card_usage",
            scope: "step",
            player: "self",
            cardFilter: {
              cardName: {
                exact: "戦闘降下強襲",
              },
            },
            sameInstanceAsSource: true,
            negate: true,
          },
        ],
        cardEventDisposition: {
          kind: "move",
          destination: "field",
        },
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "field",
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
              waivesReductionRequirement: true,
              count: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: {
                    category: ["magic"],
                  },
                },
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        applicability: { zone: "field" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_magic_use",
              timing: "flash",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            action: {
              kind: "unblockable",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribesRequired: ["地球", "ＣＦ"],
                },
                count: "all",
              },
              duration: {
                scope: "turn",
              },
            },
          },
        ],
        textRef: [7, 8],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C11",
    orikaId: 316,
    orikaIndex: 327,
    name: "官制一斉射撃",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "自分のフィールドのマジックカード1枚につき、このカードの軽減シンボル1つを満たす。",
      "",
      "フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "■お互いのアタックステップ中、このカードは、フラッシュ効果を使用できる。",
      "",
      "フラッシュ",
      "スピリット状態の自分のブレイヴを自分のスピリットに合体し、このターンの間、自分のスピリットすべてをBP+4000する。",
      "その後、自分のスピリットすべての合計BPまで、相手のスピリット/アルティメットを好きなだけ破壊する。これらの効果は、スタックタイミングで発揮されない。",
    ],
    keywordTags: ["operation"],
    tribe: "地球",
    image: "images/BSAZ01-C11.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "card_event",
          event: ["moved_to_trash"],
        },
        executionMode: "mandatory",
        condition: [
          {
            kind: "flash_used",
            target: "card_usage",
            scope: "step",
            player: "self",
            cardFilter: {
              cardName: {
                exact: "官制一斉射撃",
              },
            },
            sameInstanceAsSource: true,
            negate: true,
          },
        ],
        cardEventDisposition: {
          kind: "move",
          destination: "field",
        },
        steps: [
          {
            action: {
              kind: "move_self",
              destination: "field",
            },
          },
        ],
        textRef: [2],
      },
      {
        timing: {
          kind: "continuous",
        },
        steps: [
          {
            action: {
              kind: "treat_as",
              appliesToCard: true,
              aspects: ["reduction_symbol"],
              asColor: "yellow",
              waivesReductionRequirement: true,
              count: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: {
                    category: ["magic"],
                  },
                },
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        applicability: { zone: "field" },
        timing: { kind: "continuous" },
        timingScope: { player: "both", period: "attack" },
        steps: [
          {
            action: {
              kind: "grant_magic_use",
              timing: "flash",
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [4, 5],
      },
      {
        timing: {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            id: "select_brave",
            targetSelectionTiming: "on_step",
            action: {
              kind: "noop",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["brave"],
                  combined: false,
                },
                count: 1,
              },
            },
          },
          {
            id: "combine_host",
            targetSelectionTiming: "on_step",
            stepCondition: {
              kind: "ref_succeeded",
              stepId: "select_brave",
            },
            action: {
              kind: "brave_combine_effect",
              source: {
                stepId: "select_brave",
              },
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: 1,
              },
            },
          },
          {
            action: {
              kind: "bp_modify",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  category: ["spirit"],
                },
                count: "all",
              },
              amount: 4000,
              duration: {
                scope: "turn",
              },
            },
          },
          {
            id: "budget_destroy",
            targetSelectionTiming: "on_step",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  filterOr: [
                    {
                      category: ["spirit"],
                    },
                    {
                      category: ["ultimate"],
                    },
                  ],
                },
                count: {
                  min: 0,
                },
                budget: {
                  metric: "bp",
                  amount: {
                    source: {
                      kind: "field_bp_total",
                      player: "self",
                      filter: {
                        category: ["spirit"],
                      },
                    },
                  },
                },
              },
            },
          },
        ],
        textRef: [7, 8, 9],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C12",
    orikaId: 8,
    orikaIndex: 328,
    name: "戦力投入",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "このカードは、デッキに92枚まで入れることができ、自分のフィールドのマジックカード1枚につき、軽減シンボル1つを満たす。",
      "",
      "【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）",
      "〔ターンに1回：同名〕このカードは、自分が系統：「地球」を持つマジックカードを使用するとき、そのコストを支払う前に、ただちにメイン効果を使用できる。",
      "",
      "メイン",
      "自分のデッキの上から3枚までを裏向きでフィールドに置き、フィールド/リザーブのコア1個以上を置く。それらのカードは、フィールドにある間、「アレイオン」/コスト3/系統：「地球」・「ＣＦ」/<1>Lv1BP2000[黄]の黄の分身スピリットとして扱う。その後、このカードをフィールドに置く。（分身スピリットは、入れ替えできず、フィールドを離れたとき、破棄する。）",
    ],
    keywordTags: ["operation"],
    tribe: "地球",
    image: "images/BSAZ01-C12.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    maxDeckCount: 92,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [0後半] 使用時に印字済み軽減枠を充足: 自分のフィールドのマジックカード1枚につき黄1つ。
      //   デッキ92枚投入可は card-level maxDeckCount で実装済み (同じ textRef[0] の前半節)。
      //   BSAZ01-C07[0]/C08[0]/C09[0]/C10[0]/C11[1] と同型 (treat_as reduction_symbol +
      //   DynamicCount cards_in_zone, engine-field-magic-self-placement)。
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
        ],
        textRef: [0],
      },
      // [5,6] メイン: engine-deck-derived-clone-spirit primitive 初出実装。
      //   自分で0〜3枚を選び、デッキ上からその枚数を裏向きでフィールドに置く。フィールド/リザーブの
      //   コア1個以上を配分してゲーム終了時までの分身スピリット (公式FAQ Q782、07b §5、
      //   信頼度A) 化。「その後、このカードをフィールドに置く」は magic-system.ts の
      //   resolveMagicMainAndMoveToTrash が deferred pending (core_distribute
      //   mode:player_choice) 解決前にこのカードを trash 送りにするため、BSES01-C01[4,5]
      //   と同型に move_self(zone非依存) で表現する (move_card は使えない)。
      //   register_act_as_spirit の static_copy snapshot がカード名/コスト/系統/Lv/BP/色の
      //   完全固定スタットブロックを表現する (X04 フランドールの live_copy_from_source
      //   とは異なり、host非追従の独立ステータス)。overrides.keywords の
      //   "discard_on_leave"(新設) が「入れ替えできず、フィールドを離れたとき破棄する」を
      //   表現 (bounce/move_card 実行元でトラッシュへ強制リダイレクト、07b §5「入れ替えも
      //   破棄されるため不可」の通り cannot_swap は discard_on_leave の帰結として自動充足)。
      //   "cannot_combine" は公式分身ルール「ブレイヴ合体不可」を適用 (カード本文の
      //   reminder text には無いが Q782 の一般裁定が正源)。
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "place_face_down",
            action: {
              kind: "move_card",
              from: { zone: "deck", player: "self", position: "top" },
              to: { zone: "field", player: "self" },
              count: { min: 0, max: 3 },
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
                  symbolColors: ["yellow"],
                  tribes: ["地球", "ＣＦ"],
                  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
                  colors: ["yellow"],
                },
              },
              overrides: {
                cardName: "アレイオン",
                keywords: ["discard_on_leave", "cannot_combine"],
              },
            },
          },
          {
            action: {
              kind: "move_self",
              destination: "field",
            },
          },
        ],
        textRef: [5, 6],
      },
      // [2,3] 【タイプ：作戦】（フィールドに置かれている間、次の効果を発揮する。）＋
      //   〔ターンに1回：同名〕自分が系統：「地球」を持つマジックカードを使用するとき、
      //   そのコストを支払う前に、ただちにメイン効果(=effects[1]、triggerEffectIndex:1)を
      //   使用できる。他カードのコスト支払いに割り込む cross-card pre-cost トリガーは
      //   全カード中このカードのみの語法 (2026-07-09/07-10 grep確認、既存 primitive 前例なし)。
      //   engine-magic-field-pre-cost-payment-trigger で新設した
      //   offer_magic_pre_cost_trigger primitive (pendingFieldMagicPreCostTrigger +
      //   resolve_field_magic_pre_cost_trigger legal action) で表現する。usageLimit
      //   (ターンに1回:同名) は解決側 (legal/field-magic-pre-cost-trigger.ts) が
      //   per_card_name/turn で消費する。
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "offer_magic_pre_cost_trigger",
              player: "self",
              tribeFilter: ["地球"],
              triggerEffectIndex: 1,
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [2, 3],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C13",
    orikaId: 317,
    orikaIndex: 329,
    name: "デューカリオン",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 8,
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
        requiredCores: 0,
        bp: 0,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 0,
      },
    ],
    symbolColors: ["yellow", "yellow"],
    textLines: [
      "〔ターンに1回：同名〕手札にあるこのカードは、自分のライフが3以下に減ったとき、軽減シンボルすべてを満たして配置できる。そうしたとき、シンボル2つ以上の相手のスピリット/アルティメット/ネクサス1つを破壊できる。これらの効果は、相手の効果で防げない。",
      "",
      "Lv1-Lv2【弾幕：コスト9以下】",
      "系統：「地球」を持つ自分のネクサスは、相手のコスト9以下の効果を受けない。",
      "",
      "Lv2 フラッシュ『お互いのアタックステップ』",
      "〔ターンに1回：同名〕自分の「伊奈帆」/「アセイラム」がいるとき、フィールド/トラッシュの「戦力投入」1枚のメイン効果を発揮する。",
    ],
    keywordTags: [],
    tribe: "火星・地球・アルドノア",
    image: "images/BSAZ01-C13.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // [0] 手札にあるこのカードは、自分のライフが3以下に減ったとき、軽減シンボル
        // すべてを満たして配置できる。そうしたとき、シンボル2つ以上の相手の
        // スピリット/アルティメット/ネクサス1つを破壊できる。これらの効果は防げない。
        // reduce_life game_event + life_value(max:3) は手札誘発先例 (BSTS01-R03/BSTH09.2-TR03)、
        // 自己配置は summon(target:self, zone:hand) + costModifier:"full_reduction" で表す。
        // 後段 destroy は ref_succeeded(place-self) で「そうしたとき」をゲートする。
        timing: { kind: "game_event", player: "self", event: "reduce_life" },
        applicability: { zone: "hand" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        preventionLevel: "unpreventable",
        condition: [{ kind: "life_value", player: "self", max: 3 }],
        steps: [
          {
            id: "place-self",
            action: {
              kind: "summon",
              target: { kind: "self", zone: "hand" },
              costModifier: "full_reduction",
            },
          },
          {
            connector: "sequential",
            stepCondition: { kind: "ref_succeeded", stepId: "place-self" },
            executionMode: "optional",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["spirit", "ultimate", "nexus"],
                  minSymbolCount: 2,
                },
                count: 1,
              },
            },
          },
        ],
        textRef: [0],
      },
      {
        // [2,3] Lv1-Lv2【弾幕：コスト9以下】系統「地球」を持つ自分のネクサスは、
        // 相手のコスト9以下の効果を受けない。BSAZ02-C05【弾幕】と同じ
        // effect_immunity(sourceScope.maxCost) で、対象だけ自己ではなく自分の地球ネクサス全体。
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 2 } },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["nexus"], tribes: ["地球"] },
                count: "all",
              },
              duration: { scope: "permanent" },
              sourceScope: { maxCost: 9 },
            },
          },
        ],
        textRef: [2, 3],
      },
      {
        // [5,6] Lv2 フラッシュ『お互いのアタックステップ』ターンに1回:同名、
        // 自分の「伊奈帆」/「アセイラム」がいるとき、フィールド/トラッシュの
        // 「戦力投入」1枚のメイン効果を発揮する。borrow_magic_effect は BSAZ01-C14/CX01 と同型。
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        applicability: { level: { min: 2, max: 2 } },
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        condition: [
          {
            kind: "field_has",
            player: "self",
            cardNames: [{ contains: "伊奈帆" }, { contains: "アセイラム" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: ["field", "trash"],
                filter: {
                  category: ["magic"],
                  cardName: [{ contains: "戦力投入" }],
                  hasActivatedEffectMode: ["main"],
                },
                count: 1,
              },
              borrowModes: ["main"],
            },
          },
        ],
        textRef: [5, 6],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C14",
    orikaId: 318,
    orikaIndex: 330,
    name: "ダルザナ・マグバレッジ",
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
      {
        level: 2,
        requiredCores: 2,
        bp: 0,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2",
      "自分が系統：「地球」を持つマジックカードのコストを支払うとき、自分のフィールドの系統：「地球」を持つマジックカードをデッキの下に戻すことで、戻した枚数1枚につき、1コスト支払ったものとして扱う。",
      "",
      "Lv2『自分のメインステップ』",
      "自分のフィールドのマジックカード1枚のメイン効果を自分の《ソウルコア》を支払って使用できる。",
    ],
    keywordTags: [],
    tribe: "地球",
    image: "images/BSAZ01-C14.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        // engine-cost-modify-player-scoped-zone-discount: player+cardFilter 版
        // cost_modify+useCostPayment (getMagicZoneCostDiscountOptions 拡張)。
        // maxCount: 原文に上限枚数の明記は無いが、戻す枚数は自分のフィールドの
        // 地球マジック候補数が実質上限 (findCandidates/bestCaseCount が候補数で
        // 自動クランプする) のため、十分大きい固定値を置く。
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: { category: ["magic"], tribes: ["地球"] },
              modifier: { additionalCostValue: -1 },
              useCostPayment: {
                kind: "return_to_deck_bottom_field",
                sourceZone: "field",
                maxCount: 10,
                filter: { category: ["magic"], tribes: ["地球"] },
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [0, 1],
      },
      {
        // engine-magic-use-soul-core-cost-borrow: 発動コスト=P3-125 Step1 と同型
        // (from:field+includeReserve, effectKind:"explicit_soul_core", to:removed_from_game。
        // BSLH01-X06 等 precedent)＋borrow_magic_effect(zone:"field", hasActivatedEffectMode:["main"],
        // borrowModes:["main"]。BSAZ01-CX01 の pay_cost+conditional_cost 版と同型の結線
        // (connector:"conditional_cost" は pay_cost 専用ではなく前段 step の action.kind に
        // 依らず「次ステップの target shortage で前段コストをロールバックする」汎用機構
        // effect-interpreter.ts:2914)。フィールドに借用可能なメイン効果マジックが無いときは
        // ソウルコアも消費しない。原文に頻度制限が無く、ソウルコア消費自体が自然な使用回数
        // 上限のため usageLimit 不要。
        timing: { kind: "activated", mode: "main" },
        condition: [{ kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self", includeReserve: true },
              to: { kind: "removed_from_game", player: "self" },
              amount: 1,
              effectKind: "explicit_soul_core",
            },
          },
          {
            connector: "conditional_cost",
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "field",
                filter: {
                  category: ["magic"],
                  hasActivatedEffectMode: ["main"],
                },
                count: 1,
              },
              borrowModes: ["main"],
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C15",
    orikaId: 319,
    orikaIndex: 331,
    name: "不見咲カオル",
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
      {
        level: 2,
        requiredCores: 1,
        bp: 0,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2『自分のドローステップ』",
      "自分の手札1枚を破棄することで、ドロー枚数を+1する。破棄したカードが、「ダルザナ・マグバレッジ」のとき、トラッシュに置くかわりにコスト支払わずに配置する。",
      "",
      "Lv2",
      "自分の手札/フィールド/トラッシュの系統：「地球」を持つマジックカードは、相手の効果を受けない。",
    ],
    keywordTags: [],
    tribe: "地球",
    image: "images/BSAZ01-C15.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "phase", step: "draw", whose: "self" },
        inline: true,
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "draw_modify",
              amount: 1,
              duration: { scope: "step", step: "draw" },
              prepaidCost: {
                kind: "discard_hand",
                cardFilter: {},
                discardDisposition: {
                  kind: "move_instead",
                  ifCardFilter: {
                    category: ["nexus"],
                    cardName: { contains: "ダルザナ・マグバレッジ" },
                  },
                  destination: "field",
                },
              },
            },
          },
        ],
        textRef: [0, 1],
      },
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
                filter: { category: ["magic"], tribes: ["地球"] },
                count: "all",
                zone: ["hand", "field", "trash"],
              },
              duration: { scope: "while_on_field" },
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C16",
    orikaId: 320,
    orikaIndex: 332,
    name: "カーム・クラフトマン",
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
      {
        level: 2,
        requiredCores: 2,
        bp: 0,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1-Lv2『このネクサスの配置時』",
      "自分のデッキを上から5枚オープンできる。そうしたとき、その中の系統：「地球」と「ＣＦ」を持つスピリットカード1枚と、系統：「地球」を持つブレイヴカード1枚を手札に加える。残ったカードはデッキの下に戻す。",
      "",
      "Lv2",
      "系統：「地球」と「ＣＦ」を持つ自分のスピリットが相手によってフィールドを離れたとき、自分の手札1枚を破棄することで、トラッシュの系統：「地球」と「ＣＦ」を持つスピリットカード1枚を手札に戻す。",
    ],
    keywordTags: [],
    tribe: "地球",
    image: "images/BSAZ01-C16.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1-Lv2『配置時』デッキ5枚オープン→地球・ＣＦスピリット1枚＋地球ブレイヴ1枚を手札、残りデッキ下。
      {
        timing: {
          kind: "card_event",
          event: "place",
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  count: 1,
                  filter: {
                    tribes: ["地球", "ＣＦ"],
                    tribesLogic: "and",
                    category: ["spirit"],
                  },
                  mandatory: true,
                },
                {
                  count: 1,
                  filter: {
                    tribes: ["地球"],
                    category: ["brave"],
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
      // Lv2 地球・ＣＦスピリットが相手により離脱時、手札1枚破棄でトラッシュの地球・ＣＦスピリット1枚を手札。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          exactEventKind: true,
          triggerFilter: {
            category: ["spirit"],
            tribes: ["地球", "ＣＦ"],
            tribesLogic: "and",
          },
          cause: ["opponent_effect", "battle"],
        },
        condition: [{ kind: "min_level", value: 2 }],
        executionMode: "optional",
        steps: [
          { action: { kind: "discard", count: 1, player: "self" } },
          {
            id: "c16-recover",
            connector: "conditional_cost",
            action: {
              kind: "move_card",
              target: {
                kind: "filter",
                player: "self",
                zone: "trash",
                filter: {
                  category: ["spirit"],
                  tribes: ["地球", "ＣＦ"],
                  tribesLogic: "and",
                },
                count: 1,
              },
              from: {
                zone: "trash",
                player: "self",
                filter: {
                  category: ["spirit"],
                  tribes: ["地球", "ＣＦ"],
                  tribesLogic: "and",
                },
              },
              to: { zone: "hand" },
              count: 1,
              requireFullCount: true,
            },
          },
        ],
        textRef: [3, 4],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C17",
    orikaId: 321,
    orikaIndex: 333,
    name: "戦術データリンク",
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
    ],
    symbolColors: ["yellow"],
    textLines: [
      "Lv1",
      "系統：「地球」と「ＣＦ」を持つ自分のスピリットが相手によってフィールドを離れるとき、自分のデッキを上から2枚オープンできる。その中の系統：「地球」を持つマジックカード1枚をフィールドに置く。残ったカードはデッキの下に戻す。",
    ],
    keywordTags: [],
    tribe: "地球",
    image: "images/BSAZ01-C17.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    // 地球・ＣＦスピリットが相手によってフィールドを離れるとき、デッキ上2枚オープンし地球マジック1枚を
    // フィールドに置く（第三者観測、BSTH02.7-effects[game_event leave_field] と同型）。
    // deck_reveal.picks[].destination:"field" は BSSG01/BSTH003/BSTH06/BSTS01 で既実装済みの
    // 汎用「デッキから直接フィールド配置」primitive（配置時誘発が発火する）。
    effects: [
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "leave_field",
          triggerFilter: {
            category: ["spirit"],
            tribes: ["地球", "ＣＦ"],
            tribesLogic: "and",
          },
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 2,
              picks: [
                {
                  count: 1,
                  filter: {
                    category: ["magic"],
                    tribes: ["地球"],
                  },
                  destination: "field",
                  mandatory: true,
                },
              ],
              remainder: "bottom",
            },
          },
        ],
        textRef: [0, 1],
      },
    ],
  },
  {
    cardNo: "BSAZ01-C18",
    combinedBoost: 4000,
    orikaId: 6,
    orikaIndex: 334,
    name: "アナリティカルエンジン",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: [],
    textLines: [
      "スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない。",
      "〔重複不可〕このカード/ブレイヴは、「界塚伊奈帆」が合体している自分のスピリットに追加で合体できる。",
      "〔ターンに1回：同名〕手札/トラッシュにあるこのカードは、自分のスピリットに「界塚伊奈帆」が合体したとき、そのスピリットに直接合体するように召喚できる。",
      "",
      "Lv1『このブレイヴの召喚時』",
      "トラッシュにある系統：「地球」を持つマジックカード3枚までをフィールドに置く。",
      "",
      "【合体条件：ＣＦ＆「界塚伊奈帆」合体中】",
      "【合体中】『このスピリットのアタック時』",
      "自分のフィールドのマジックカード5枚につき、このスピリットに黄のシンボル1つを追加する。",
    ],
    keywordTags: [],
    tribe: "地球・アルドノア",
    image: "images/BSAZ01-C18.webp",
    rarity: "C",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    maxDeckCount: 3,
    // 【合体条件：ＣＦ＆「界塚伊奈帆」合体中】。ＣＦ host 条件は top-level braveCondition、
    // 「界塚伊奈帆」合体中は BraveCondition.attachedBraveNameContains で表現する。
    braveCondition: {
      categories: ["spirit"],
      tribes: ["ＣＦ"],
      attachedBraveNameContains: ["界塚伊奈帆"],
    },
    // [1] 〔重複不可〕「界塚伊奈帆」合体スピリットに追加で合体できる。
    // braveLimitExemption（合体数に数えない）ではなく、C18 自身は数えたまま host の上限を
    // 1 枠だけ増やす。maxPerHost:1 で同一 host への C18 複数積みを禁止する。
    additionalBraveSlot: {
      hostCondition: {
        categories: ["spirit"],
        tribes: ["ＣＦ"],
        attachedBraveNameContains: ["界塚伊奈帆"],
      },
      requiredAttachedBraveNameContains: ["界塚伊奈帆"],
      maxPerHost: 1,
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // [1,7] 追加合体と合体条件は top-level braveCondition/additionalBraveSlot で表現。
      {
        timing: { kind: "continuous" },
        steps: [],
        textRef: [1, 7],
      },
      // [0] スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない。
      // 2026-08-15 ユーザー確認: スピリット状態ブレイヴの疲労不可/攻防不可はルール強度。
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
      // [2] 手札/トラッシュにあるこのカードは、「界塚伊奈帆」が合体した host へ
      //   コスト不要で直接合体召喚できる。trigger_related_combined_host は
      //   brave_combined の主語ブレイヴから「そのスピリット」を逆引きする。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "brave_combined",
          triggerFilter: { cardName: { contains: "界塚伊奈帆" } },
        },
        applicability: { zone: ["hand", "trash"] },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "turn", maxCount: 1 },
        steps: [
          {
            action: {
              kind: "brave_combine_effect",
              asSummon: true,
              target: {
                kind: "trigger_related_combined_host",
                player: "self",
                filter: { category: ["spirit"] },
              },
            },
          },
        ],
        textRef: [2],
      },
      // [4,5] Lv1『このブレイヴの召喚時』トラッシュの地球マジック3枚までをフィールドへ。
      {
        timing: { kind: "card_event", event: "summon" },
        // 直接合体はコア0可だが、ブレイヴ自身の召喚時効果は発動する (10_rules/05:10-14)。
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { category: ["magic"], tribes: ["地球"] },
              count: { min: 0, max: 3 },
              destination: "field",
            },
          },
        ],
        textRef: [4, 5],
      },
      // [8,9] 【合体中】アタック時、フィールドのマジック5枚につき黄シンボル1つ追加。
      //   target:self は合体中ブレイヴ発揮元では host へ解決されるため「このスピリット」に一致する。
      //   「フィールドのカード枚数につき」型のシンボル追加は発揮中 live 変動する
      //   (公式Q&A BS64 Q10488 / CB10 Q13962)。
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { combined: true },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "symbol_add",
              target: { kind: "self" },
              symbol: "yellow",
              count: {
                source: {
                  kind: "cards_in_zone",
                  zone: "field",
                  player: "self",
                  filter: { category: ["magic"] },
                },
                divisor: 5,
              },
              duration: { scope: "battle" },
            },
          },
        ],
        textRef: [8, 9],
      },
    ],
  },
  {
    cardNo: "BSAZ01-CX01",
    combinedBoost: 6000,
    orikaId: 7,
    orikaIndex: 335,
    name: "界塚伊奈帆",
    printedCategory: "brave",
    colors: ["yellow"],
    cost: 4,
    reductionSymbols: ["yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 0,
        bp: 1000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "魂/スピリット状態のこのカード/ブレイヴは、召喚/煌臨した自分のスレイプニールに合体できる。",
      "スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない。",
      "",
      "Lv1『自分のメインステップ』",
      "[ゲームに1回：同名]自分はデッキの上から13枚オープンでき、その中の系統：「地球」を持つマジックカード3枚までをフィールドに置き、コスト4以下の「スレイプニール」1枚をコストを支払わずに召喚する。オープンしたカードの効果は発揮されず、残ったカードはデッキの下に戻す。",
      "",
      "【合体条件：スレイプニール】",
      "【合体中】 フラッシュ/スタック『お互いのアタックステップ』",
      "ターンに1回、1コスト支払うことで、フィールドの系統：「地球」を持つマジックカードのフラッシュ/スタック効果を発揮する。",
    ],
    keywordTags: ["contract"],
    tribe: "地球・アルドノア",
    image: "images/BSAZ01-CX01.webp",
    rarity: "CX",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    // 【合体条件：スレイプニール】([6])。通常のメインステップ合体/合体維持/効果内合体の
    // 適格判定が見る CardDefinition 直下の braveCondition へ配線する。一方 [0] は
    // 「召喚/煌臨した」そのスレイプニールにも合体できる追加タイミング許可なので、
    // 末尾の game_event + brave_combine_effect で event 主語を固定する。
    braveCondition: { cardNameContains: ["スレイプニール"] },
    effects: [
      // [1] スピリット状態のこのブレイヴは疲労せず、アタック/ブロックできない。
      //   BSGE01-C05 と同型 (continuous + applicability.combined:false + effect_resistance
      //   (exhaust) + prevent_battle、ruleStrength:true)。「召喚/煌臨した自分のスレイプニールに合体できる」
      //   (スピリット状態の半分) は上記 braveCondition により実現するため、この行に textRef は
      //   持たせない（合体可否自体は CardDefinition フィールドの効果であり、effects[] の
      //   ステップを要しない。BSGE01-C05:322 と同じ扱い）。
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
        textRef: [1],
      },
      // [0] 魂/スピリット状態のこのカード/ブレイヴは、召喚/煌臨した自分のスレイプニールに
      //   合体できる。通常 brave_combine とは別に、末尾の誘発効果で event 主語
      //   (trigger_related_instance) にも合体できる。
      // [3,4] Lv1『自分のメインステップ』[ゲームに1回：同名]デッキ上13枚オープン→
      //   系統「地球」マジック3枚までをフィールドに置き、コスト4以下「スレイプニール」1枚を
      //   コスト不要召喚。残りはデッキの下。deck_reveal の2 pick グループ
      //   (magic→destination:"field" は BSAZ01-X01/X02 と同型、spirit→destination:"field" は
      //   共通配置プリミティブ placeCardFromZoneToField が printedCategory 非依存で
      //   summon 相当のフィールド進入を行うため新規プリミティブ不要、
      //   structured-effect-interpreter.ts:458 参照)。「コスト4以下の『スレイプニール』」は
      //   DeckRevealPickFilter に cardName を新設し配線 (既存 maxCost は model.ts に型定義済み
      //   ながら DSL→v1 マッパーで未配線という別の SSOT ギャップだったため、cardName と併せて
      //   同ターンで解消。native-action-registry.ts の deck_reveal マッパー拡張、
      //   legal-actions.ts の matchesFilter へ matchesCardName 追加)。
      //   「オープンしたカードの効果は発揮されない」は deck_reveal.suppressRevealedEffects
      //   (新設フィールド) で表現する。2026-07-09 adversarial verifier round1 で
      //   「revealed disposition トリガーを持つカードが0件」という当初の grep 確認が誤りと
      //   反証された (BSES01-C01 等 card_event event:"revealed" を持つカードが実在し、
      //   findRevealedEffect が deck_reveal 実行時に無条件で評価するため、CX01 の13枚オープンで
      //   それらが出ると誤って発揮されてしまう)。findRevealedEffect の呼び出し元
      //   (structured-zone-ops.ts executeDeckReveal) 側にフラグを新設し、true のときは
      //   revealed 効果の走査自体をスキップする。原文「オープンでき」は可能形語尾＝任意
      //   (10_rules/03c) のため executionMode:"optional"。
      {
        timing: { kind: "activated", mode: "main" },
        executionMode: "optional",
        usageLimit: { kind: "per_card_name", duration: "game" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: 13,
              picks: [
                {
                  count: 3,
                  filter: { category: ["magic"], tribes: ["地球"] },
                  destination: "field",
                },
                {
                  count: 1,
                  filter: {
                    category: ["spirit", "ultimate", "brave"],
                    maxCost: 4,
                    cardName: [{ contains: "スレイプニール" }],
                  },
                  destination: "field",
                  // 「3枚まで」の地球マジックとは異なり、原文は候補があれば
                  // 「スレイプニール」1枚を召喚するため、この pick は必須。
                  mandatory: true,
                },
              ],
              remainder: "bottom",
              suppressRevealedEffects: true,
            },
          },
        ],
        textRef: [3, 4],
      },
      // [7,8] 【合体中】フラッシュ/スタック『お互いのアタックステップ』ターンに1回、1コスト
      //   支払うことで、フィールドの系統「地球」マジックのフラッシュ/スタック効果を発揮する。
      //   pay_cost(1)+conditional_cost→borrow_magic_effect(zone:"field")。フラッシュ/スタックの
      //   2枠は同一 limitGroupId で「ターンに1回」を共有する (BSAZ03-M01 effects[3,4] と同型、
      //   BSAZ03.ts:291-348 「どちらを使っても二重発動を抑止」)。timingScope 未指定だと
      //   isTimingScopeActive が無制限扱いになるため (ce-lookup.ts) お互いのアタックステップに
      //   明示的に絞る。「ターンに1回」に「同名」が無いため usageLimit は per_instance。
      {
        executionMode: "optional",
        applicability: { combined: true },
        timing: { kind: "activated", mode: "flash" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_instance", duration: "turn" },
        limitGroupId: "bsaz01-cx01-borrow",
        steps: [
          { id: "cost", action: { kind: "pay_cost", amount: 1 } },
          {
            connector: "conditional_cost",
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "field",
                filter: {
                  category: ["magic"],
                  tribes: ["地球"],
                  hasActivatedEffectMode: ["flash"],
                },
                count: 1,
              },
              borrowModes: ["flash"],
            },
          },
        ],
        textRef: [7, 8],
      },
      {
        executionMode: "optional",
        applicability: { combined: true },
        timing: { kind: "activated", mode: "stack" },
        timingScope: { player: "both", period: "attack" },
        usageLimit: { kind: "per_instance", duration: "turn" },
        limitGroupId: "bsaz01-cx01-borrow",
        steps: [
          { id: "cost", action: { kind: "pay_cost", amount: 1 } },
          {
            connector: "conditional_cost",
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: "field",
                filter: {
                  category: ["magic"],
                  tribes: ["地球"],
                  hasActivatedEffectMode: ["stack"],
                },
                count: 1,
              },
              borrowModes: ["stack"],
            },
          },
        ],
        textRef: [7, 8],
      },
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["summon", "advent"],
          triggerFilter: {
            category: ["spirit"],
            cardName: [{ contains: "スレイプニール" }],
          },
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
        textRef: [0],
      },
    ],
  },
  {
    cardNo: "BSAZ01-X01",
    orikaId: 322,
    orikaIndex: 336,
    name: "KG-6 スレイプニール[コンフォーマルパワーアシスト]",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 6,
    reductionSymbols: ["yellow", "yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 3,
        bp: 12000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "フラッシュ【煌臨：「スレイプニール」『お互いのアタックステップ』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットの煌臨/アタック/ブロック時』",
      "ターンに1回、自分はデッキの上から5枚オープンでき、その中の系統：「地球」を持つマジックカード1枚のフラッシュ効果をただちに発揮する。その後、効果を発揮したマジックカードはフィールドに置き、残ったカードは破棄する。",
      "",
      "Lv1-Lv2 フラッシュ『お互いのアタックステップ』",
      "ターンに1回、相手のスピリット/アルティメット1体をBP-5000でき、BP0になったスピリット/アルティメットを破壊する。このスピリットの合体中、この効果を[ターンに3回]に変更する。",
    ],
    keywordTags: ["advent"],
    tribe: "地球・ＣＦ",
    image: "images/BSAZ01-X01.webp",
    rarity: "X",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【煌臨：「スレイプニール」『お互いのアタックステップ』】。
    // 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1, declare_advent 配線済み）。
    // 『お互いのアタックステップ』= both_attack_step、ソウルコア→トラッシュ（カード本文どおり）。
    // adventVariant: normal（通常煌臨）。名前条件「スレイプニール」は AdventCondition.cardNames で表現する。
    adventData: {
      adventCondition: {
        targetCategory: ["spirit"],
        cardNames: [{ contains: "スレイプニール" }],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
      adventVariant: "normal",
    },
    effects: [
      // 公開したまま選択マジックを発揮し、その全解決後に配置・残札破棄する。
      // 03c「その後」: 借用前に手札へ加えたり残札をトラッシュへ送ったりしない。
      {
        timing: { kind: "card_event", event: ["advent", "attack", "block"] },
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            id: "reveal",
            action: {
              kind: "deck_reveal",
              revealCount: 5,
              picks: [
                {
                  mandatory: true,
                  count: 1,
                  filter: {
                    category: ["magic"],
                    tribes: ["地球"],
                    hasActivatedEffectMode: ["flash"],
                  },
                  destination: "field",
                },
              ],
              remainder: "trash",
              beforeMoveSteps: [
                {
                  action: {
                    kind: "borrow_magic_effect",
                    target: { kind: "ref", stepId: "reveal" },
                    borrowModes: ["flash"],
                  },
                },
              ],
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2 フラッシュ『お互いのアタックステップ』相手1体BP-5000→BP0破壊。
      // 「合体中、この効果を[ターンに3回]に変更する」= maxCountOverrides で `combined` 成立時に
      //  maxCount を 3 に上書き（2026-06-26、EffectUsageLimit.maxCountOverrides 新設）。
      {
        timing: { kind: "activated", mode: "flash" },
        executionMode: "optional",
        usageLimit: {
          kind: "per_instance",
          duration: "turn",
          maxCount: 1,
          maxCountOverrides: [{ when: [{ kind: "combined" }], maxCount: 3 }],
        },
        steps: [
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
              amount: -5000,
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
    cardNo: "BSAZ01-X02",
    orikaId: 323,
    orikaIndex: 337,
    name: "KG-6 スレイプニール[最終決戦]",
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 7,
    reductionSymbols: ["yellow", "yellow", "yellow"],
    levelDefs: [
      {
        level: 1,
        requiredCores: 1,
        bp: 8000,
      },
      {
        level: 2,
        requiredCores: 2,
        bp: 10000,
      },
    ],
    symbolColors: ["yellow"],
    textLines: [
      "フラッシュ【煌臨：「スレイプニール」『自分のターン』】",
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリットに手札から重ねる。",
      "",
      "Lv1-Lv2『このスピリットのアタック/ブロック時』",
      "ターンに1回、手札/フィールドの系統：「地球」を持つマジックカード1枚のフラッシュ効果をただちに発揮する。このとき手札から効果を発揮するマジックカードはフィールドに置く。",
      "",
      "Lv1-Lv2『このスピリットのアタック時』",
      "相手のスピリット/アルティメット1体をBP-10000でき、BP0になったスピリット/アルティメットを破壊する。この効果をこのスピリットのブレイヴの数まで追加で発揮できる。",
    ],
    keywordTags: ["advent"],
    tribe: "地球・ＣＦ",
    image: "images/BSAZ01-X02.webp",
    rarity: "X",
    pack: "BSAZ01 アルドノア・ゼロ-地球-",
    sourceUrls: [],
    sourceConfidence: "C",
    // [0,1] フラッシュ【煌臨：「スレイプニール」『自分のターン』】。
    // 煌臨宣言は CardDefinition.adventData で表現する（11 L149 / 08a §1, declare_advent 配線済み）。
    // 『自分のターン』= own_turn、ソウルコア→トラッシュ（カード本文どおり）。
    // adventVariant: normal（通常煌臨）。名前条件「スレイプニール」は AdventCondition.cardNames で表現する。
    adventData: {
      adventCondition: {
        targetCategory: ["spirit"],
        cardNames: [{ contains: "スレイプニール" }],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "normal",
    },
    effects: [
      // Lv1-Lv2『アタック/ブロック時』ターンに1回、手札/フィールドの地球マジック1枚のフラッシュ効果を
      //   ただちに発揮する。手札の対象選択→フィールドへ置く→本文発揮（2026-09-22本文訂正・ユーザー確認）。
      //   BSAZ03-M01 の「効果発揮後」とは異なり、借用前に移動する。
      //   borrow_magic_effect。zone を trash 固定から hand/field へ拡張し、beforeMove.fromZone:["hand"]
      //   で「手札由来のときだけフィールドへ置く」を表現する。engine-field-magic-self-placement。
      //   原文「発揮する」は終止形＝強制 (10_rules/03c「する」vs「できる」) のため executionMode
      //   は省略する (card_event attack/block の既定は mandatory、同ファイル記載の revealed/
      //   moved_to_trash 限定の非対称特例には当たらない)。借用先候補が0件のときの no-op は
      //   effect-borrowing.ts の `resolvedTargetIds?.[0]` 空判定が唯一かつ主たる機構
      //   (adversarial verifier round3 確認: legal-actions-shared.ts の空撃ち
      //   resolveEmptyFireTargetCounts は buildLegalActionTargetGroups=合法手列挙/GUI層専用で、
      //   packages/rules-core/src/effect/ 配下の executeEffect 実行経路からは呼ばれない。
      //   round2 のコメントはこの2層を混同していたため round3 で訂正)。BSAZ03-M01 の
      //   borrow_magic_effect は timing.kind:"activated" で本カードの card_event mandatory
      //   経路とは異なるため、直接の同型先例ではない。
      {
        timing: { kind: "card_event", event: ["attack", "block"] },
        usageLimit: { kind: "per_instance", duration: "turn" },
        steps: [
          {
            action: {
              kind: "borrow_magic_effect",
              target: {
                kind: "filter",
                player: "self",
                zone: ["hand", "field"],
                filter: {
                  category: ["magic"],
                  tribes: ["地球"],
                  hasActivatedEffectMode: ["flash"],
                },
                count: 1,
              },
              borrowModes: ["flash"],
              beforeMove: { zone: "field", fromZone: ["hand"] },
            },
          },
        ],
        textRef: [3, 4],
      },
      // Lv1-Lv2『アタック時』相手1体BP-10000→BP0破壊。
      {
        timing: { kind: "card_event", event: "attack" },
        executionMode: "optional",
        steps: [
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
            // この効果をこのスピリットのブレイヴの数まで追加で発揮できる。
            // bp_modify を 1+（選んだ追加回数）回（各回 fresh target を BP-10000）実行し、
            // 後段が BP0 遷移対象だけを一括破壊する。
            repeat: {
              additional: { source: { kind: "braves_on_source" } },
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
    ],
  },
];
