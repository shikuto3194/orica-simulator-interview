import type { CardDefinition } from "@orica/rules-core";

export const BSTH005_CARDS: CardDefinition[] = [
  {
    cardNo: "BSTH005-TX01(A)",
    orikaId: 472,
    orikaIndex: 44,
    name: "魔界",
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
      "自分のライフが増えた/減ったか、このネクサスが相手によってフィールドを離れるとき、このネクサスに自分の《ソウルコア》を置いて裏返せる。",
      "",
      "Lv1『このネクサスの配置時』",
      "このターンの間、相手のスピリット/アルティメット1体をBP-8000でき、BPが0になった対象を破壊できる。",
      "",
      "Lv1『お互いのアタックステップ』",
      "ターンに1回、自分が黄1色のカードを召喚/使用したとき、自分の手札が5枚以下なら、自分はデッキの上から1枚ドローできる。",
    ],
    keywordTags: ["double_sided"],
    tribe: "幻想・導魔・四道",
    image: "images/BSTH005-TX01(A).webp",
    rarity: "TX",
    pack: "BSTH005 東方怪綺談",
    maxDeckCount: 3,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // Lv1【転醒：自分のカウント9以下】自分のライフが増えた/減ったとき裏返せる。
      // ライフ増加 = core_placed_on_life（P3-14 C-2）、ライフ減少 = reduce_life。
      // BSSA01-転醒X01(A)/転醒X04(A) 先例 (transcendenceFlipTriggerEffects) と同型の
      // 2エントリ分割 (game_event + card_event leave_field) を踏襲。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: ["reduce_life", "core_placed_on_life"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 9 }],
        steps: [
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "rebirth",
              maxCount: 9,
              vanishAfterFlipOnLvDeficit: true,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1【転醒：自分のカウント9以下】このネクサスが相手によってフィールドを離れるとき裏返せる。
      {
        timing: {
          kind: "card_event",
          event: "leave_field",
          cause: ["opponent_effect", "battle"],
        },
        executionMode: "optional",
        condition: [{ kind: "count_value", player: "self", max: 9 }],
        steps: [
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "field", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "reserve", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "trash", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            stepCondition: { kind: "rebirth_precheck", maxCount: 9 },
            action: {
              kind: "core_move",
              from: { kind: "life", player: "self" },
              to: { kind: "this_card" },
              amount: "all",
              effectKind: "explicit_soul_core",
            },
          },
          {
            action: {
              kind: "rebirth",
              maxCount: 9,
              vanishAfterFlipOnLvDeficit: true,
            },
          },
        ],
        textRef: [0, 1],
      },
      // Lv1『このネクサスの配置時』このターン、相手スピ/アル1体をBP-8000、BP0で破壊。
      {
        timing: { kind: "card_event", event: "place" },
        executionMode: "optional",
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
            executionMode: "optional",
          },
        ],
        textRef: [3, 4],
      },
      // Lv1『お互いのアタックステップ』ターン1回、自分が黄1色のカードを召喚/使用したとき、
      // 手札5枚以下なら1ドロー。「召喚/使用」は単一Timingで表現不可 (BSLH01-R03 precedent、
      // structured-effect-registrations.ts EVENT_KIND_TO_FAMILY 分岐) のため2エントリに分割し、
      // limitGroupId で「ターンに1回」を共有する。
      {
        timing: {
          kind: "game_event",
          player: "self",
          event: "summon",
          triggerFilter: { colors: ["yellow"], colorCount: "mono" },
          exactEventKind: true,
        },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "hand_count", player: "self", max: 5 }],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        limitGroupId: "BSTH005-TX01-yellow-mono-draw",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [6, 7],
      },
      {
        // 「使用」= マジックカードの使用。effect_declaration は
        // queueEffectDeclarationTriggers (P3-75 発揮前チェックポイント) 由来で
        // pendingEffect.actingPlayerId が responder 側に反転する特殊 family のため、
        // player:"self" でも既定 whose:"self" の raw actingPlayerId 一致に頼れず
        // sourceWhose を明示して relatedPlayerId (=実際の使用者) 基準に切り替える
        // 必要がある (BSLH01-R03 の opponent 版 sourceWhose 明示先例と対称)。
        timing: {
          kind: "game_event",
          player: "self",
          event: "effect_declaration",
          triggerEffectActionKind: "magic",
          triggerFilter: { colors: ["yellow"], colorCount: "mono" },
          sourceWhose: "self",
        },
        timingScope: { player: "both", period: "attack" },
        condition: [{ kind: "hand_count", player: "self", max: 5 }],
        executionMode: "optional",
        usageLimit: { kind: "per_instance", duration: "turn" },
        limitGroupId: "BSTH005-TX01-yellow-mono-draw",
        steps: [{ action: { kind: "draw", count: 1 } }],
        textRef: [6, 7],
      },
    ],
    isDoubleSided: true,
    backFace: {
      name: "［創造の魔界神］神綺",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 6,
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
      ],
      symbolColors: ["yellow"],
      textLines: [
        "この面に裏返ったとき、フィールドに残り、カウント+1する。",
        "",
        "Lv1-Lv2『このスピリットの転醒時』",
        "このターンの間、自分のカウント1につき、相手のスピリット/アルティメット1体はアタック/ブロックできない。",
        "",
        "Lv1-Lv2『根幻回帰』",
        "相手の効果でフィールドを離れるとき、裏返して配置できる。",
        "",
        "Lv1-Lv2",
        "自分の黄のスピリット/アルティメットがアタックしたとき、このターンの間、相手のスピリット/アルティメット1体をBP-8000でき、BP0になった対象を破壊できる。",
      ],
      keywordTags: [],
      tribe: "起幻・幻想・導魔",
      image: "images/BSTH005-TX01(B).webp",
      rarity: "TX",
      pack: "BSTH005 東方怪綺談",
      cardNo: "BSTH005-TX01(B)",
      effects: [
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
                  count: { source: { kind: "count_value", player: "self" } },
                },
                restriction: ["attack", "block"],
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
          executionMode: "optional",
          steps: [{ action: { kind: "reverse_rebirth", mode: "summon" } }],
          textRef: [5, 6],
        },
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "attack",
            triggerFilter: {
              category: ["spirit", "ultimate"],
              colors: ["yellow"],
            },
          },
          executionMode: "optional",
          steps: [
            {
              id: "bp-zero",
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit", "ultimate"] },
                  count: 1,
                },
                amount: -8000,
                duration: { scope: "turn" },
              },
            },
            {
              connector: "sequential",
              executionMode: "optional",
              action: {
                kind: "destroy",
                target: {
                  kind: "ref",
                  stepId: "bp-zero",
                  result: "bp_became_zero",
                },
              },
            },
          ],
          textRef: [8, 9],
        },
      ],
    },
  },
];
