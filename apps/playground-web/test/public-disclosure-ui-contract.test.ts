import { describe, expect, it } from "vitest";
import type {
  CardDefinition,
  GameState,
  LegalAction,
  PublicDisclosure,
} from "@orica/rules-core";
import {
  PUBLIC_DISCLOSURE_ARROW_PRESENTATION_MS,
  PUBLIC_DISCLOSURE_CARD_EXIT_MS,
  PUBLIC_DISCLOSURE_PRESENTATION_MS,
  buildPublicDisclosureArrowGeometry,
  describePublicDisclosure,
  hasPublicDisclosureEffectTreeLegalAction,
  isContinuousTargetDisclosure,
  isPublicDisclosureCardPresentationEligible,
  isPublicDisclosureLoggable,
  publicDisclosurePresentationCards,
  publicDisclosureReferencedCards,
  publicDisclosureAutoDismissDelay,
} from "../src/components/PublicDisclosurePanel";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const battleScreen = readFileSync(
  resolve(__dirname, "../src/components/BattleScreen.tsx"),
  "utf8"
);
const fieldArea = readFileSync(
  resolve(__dirname, "../src/components/FieldArea.tsx"),
  "utf8"
);
const battleCss = readFileSync(resolve(__dirname, "../src/battle.css"), "utf8");
const publicDisclosurePanel = readFileSync(
  resolve(__dirname, "../src/components/PublicDisclosurePanel.tsx"),
  "utf8"
);

describe("public disclosure UI contract", () => {
  it("uses sanitized state for board visualization/log without a notification HUD", () => {
    expect(battleScreen).toContain('data-testid="btn-public-disclosure-log"');
    expect(battleScreen).toMatch(
      /<PublicDisclosurePanel\s+state=\{publicDisclosureDisplayState\}/
    );
    // Room logs/presentations consume confirmed history, never the optimistic
    // board. The delayed-rejection GUI test covers the behavioral consequence.
    expect(battleScreen).toMatch(
      /const publicDisclosureDisplayState = useMemo\(\(\) => \{\s*if \(!roomId\) return displayState;/
    );
    expect(battleScreen).toContain(
      "sanitizeStateForViewer(roomPublicDisclosureState, viewingPlayer)"
    );
    expect(battleScreen).toMatch(
      /const applyRoomAuthoritativeState = useCallback\([\s\S]*?setRoomPublicDisclosureState\(nextState\)/
    );
    expect(battleScreen).not.toContain("<LogPanel log={state.log}");
    expect(publicDisclosurePanel).toContain(
      'data-testid="public-disclosure-arrows"'
    );
    expect(publicDisclosurePanel).toContain(
      'data-testid="public-disclosure-effect-source"'
    );
    expect(publicDisclosurePanel).toContain(
      'className="public-disclosure-arrow public-disclosure-arrow-body"'
    );
    expect(publicDisclosurePanel).toContain(
      "public-disclosure-target-tag public-disclosure-target-tag--"
    );
    expect(publicDisclosurePanel).not.toContain("<line");
    expect(publicDisclosurePanel).toContain(
      'className="public-disclosure-effect-source effect-queue-card active"'
    );
    expect(publicDisclosurePanel).toContain(
      'data-testid="public-disclosure-log-modal"'
    );
    expect(publicDisclosurePanel).not.toContain("効果を適用する");
    expect(publicDisclosurePanel).toContain(
      'data-testid="public-disclosure-active"'
    );
    expect(publicDisclosurePanel).toContain(
      'data-testid="public-disclosure-card-presentation"'
    );
    expect(publicDisclosurePanel).toContain(
      "publicDisclosureDismissedSequences"
    );
    expect(battleScreen).toContain("suppressInitialPresentation: true");
    expect(battleScreen).toMatch(
      /const suppressTargetDeclaredPresentation =\s*pendingAction !== null && targetCandidateIds !== null;/
    );
    expect(battleScreen).toContain(
      "suppressTargetDeclaredPresentation={suppressTargetDeclaredPresentation}"
    );
    expect(battleScreen).toContain(
      "getCardPresentationExitAnchor={getPublicDisclosureExitAnchor}"
    );
    expect(battleScreen).toContain(
      "onCardPresentationExit={pulsePublicDisclosureExitAnchor}"
    );
    expect(publicDisclosurePanel).toMatch(
      /disclosure\.kind === "target_declared"[\s\S]*return suppressTargetDeclaredPresentation !== true;/
    );
    expect(publicDisclosurePanel).toContain(
      "public-disclosure-card-presentation-exit"
    );
    expect(PUBLIC_DISCLOSURE_CARD_EXIT_MS).toBeGreaterThan(0);
    expect(battleCss).toContain("public-disclosure-card-to-more-menu");
    expect(battleCss).toContain("public-disclosure-more-menu-pulse");
    expect(battleCss).toContain("width: max-content;");
    expect(battleCss).toContain("max-width: calc(100vw - 24px);");
    expect(battleCss).toContain("flex-wrap: wrap;");
    expect(battleCss).toContain("justify-content: flex-end;");
    expect(battleCss).toContain("min-width: 54px;");
    expect(publicDisclosurePanel).toContain(
      "snapshotCards={browseCards.cards}"
    );
    expect(publicDisclosurePanel).toContain(
      ".sort((a, b) => b.sequence - a.sequence)"
    );
    expect(publicDisclosurePanel).not.toContain(
      "public-disclosure-summary-presentation"
    );
    expect(publicDisclosurePanel).not.toContain(
      'data-testid="public-disclosure-notice"'
    );
    expect(battleScreen).toContain("<EffectQueueOverlay");
    expect(battleScreen).toContain("<DeckRevealModal");
    expect(battleScreen).toContain("<ZoneBrowseModal");
  });

  it("pins soul-state cards to the scroll origin before combined and ordinary field cards", () => {
    expect(fieldArea).toMatch(
      /const aIsSoulState = soulStateIds\.has\(a\.instanceId\)/
    );
    expect(fieldArea).toMatch(/const sortedNexuses = useMemo/);
    expect(fieldArea).toContain("{sortedNexuses.map((card) => {");
    expect(fieldArea).toContain("const soulSpiritLayoutById = useMemo");
    expect(fieldArea).toContain("const soulNexusLayoutById = useMemo");
    expect(fieldArea).toContain("soul-state-field-card soul-state-spirit");
    expect(fieldArea).toContain("soul-state-field-card soul-state-nexus");
    expect(battleCss).toContain(".field-center-scroll .soul-state-field-card");
    expect(battleCss).toContain(".public-disclosure-effect-source");
    expect(battleCss).toContain("public-disclosure-source-to-corner");
    expect(battleCss).toContain("position: absolute;");
    // 疲労回転と魂状態の表示は card-exhaustion-display.test.ts で実描画を検証する。
  });
});

describe("burst / mirage board layout contract", () => {
  it("renders mirage cards inside the reserved burst area", () => {
    const burstSlotIndex = fieldArea.indexOf("className={`burst-slot");
    const mirageSlotIndex = fieldArea.indexOf('className="mirage-slot"');
    const lifeDisplayIndex = fieldArea.indexOf("className={`life-display");

    expect(burstSlotIndex).toBeGreaterThanOrEqual(0);
    expect(mirageSlotIndex).toBeGreaterThan(burstSlotIndex);
    expect(lifeDisplayIndex).toBeGreaterThan(mirageSlotIndex);
    expect(fieldArea).toContain("const hasMirage = mirageCards.length > 0;");
    expect(battleCss).toContain(
      "width: calc(var(--burst-card-w) + var(--burst-layer-offset-x));"
    );
    expect(battleCss).toContain("bottom: 0;");
    expect(battleCss).toContain("right: 0;");
    expect(battleCss).toContain(".field-opponent .burst-card-layer");
    expect(battleCss).toContain(".field-opponent .mirage-slot");
  });
});

describe("public disclosure log wording", () => {
  it.each([
    ["hand", "add_to_hand", "手札へ", "手札に移動する"],
    ["trash", "discard", "トラッシュへ", "トラッシュに移動する"],
    ["deck", "move_to_bottom", "デッキ下へ", "デッキの下"],
    ["deck", "move_to_top", "デッキ上へ", "デッキの上"],
    ["deck", "action_execute", "デッキへ", "デッキに移動する"],
    ["field", "place", "フィールドへ", "フィールドに移動する"],
    ["burst", "action_execute", "バーストへ", "バーストに移動する"],
    ["mirage", "mirage_set", "ミラージュへ", "ミラージュに移動する"],
  ] as const)(
    "裏向きの %s / %s は移動先だけで通知・ログを作る",
    (to, actionLabel, badge, log) => {
      const disclosure: PublicDisclosure = {
        id: "hidden-destination",
        sequence: 1,
        turnNumber: 1,
        step: "main",
        actorPlayerId: "bob",
        audience: "both",
        kind: "zone_moved",
        targets: [],
        results: [
          {
            kind: "hidden_card_move",
            count: 1,
            from: "hand",
            to,
            actionLabel,
            hiddenReason: "face_down",
          },
        ],
      };
      const state = { cardInstances: [] } as unknown as GameState;
      const lookup = () => {
        throw new Error("Hidden card identities must not be queried");
      };
      expect(
        publicDisclosurePresentationCards(disclosure, state, lookup)
      ).toMatchObject([
        { definitionIdSnapshot: "_hidden_card_", actionLabel: badge },
      ]);
      expect(
        publicDisclosureReferencedCards(disclosure, state, lookup)
      ).toMatchObject([
        { definitionIdSnapshot: "_hidden_card_", actionLabel: badge },
      ]);
      expect(
        describePublicDisclosure(disclosure, state, "alice", lookup)
      ).toContain(log);
    }
  );
  it("非公開バーストセットの裏面にも実際の移動先を表示する", () => {
    const disclosure: PublicDisclosure = {
      id: "hidden-burst",
      sequence: 1,
      turnNumber: 1,
      step: "main",
      actorPlayerId: "bob",
      audience: "both",
      kind: "zone_moved",
      targets: [],
      results: [
        {
          kind: "hidden_card_move",
          count: 2,
          from: "hand",
          to: "burst",
          actionLabel: "action_execute",
        },
      ],
    };
    const state = { cardInstances: [] } as unknown as GameState;
    expect(isPublicDisclosureCardPresentationEligible(disclosure)).toBe(true);
    expect(
      publicDisclosurePresentationCards(disclosure, state, () => undefined)
    ).toMatchObject([
      { definitionIdSnapshot: "_hidden_card_", actionLabel: "バーストへ" },
      { definitionIdSnapshot: "_hidden_card_", actionLabel: "バーストへ" },
    ]);
    expect(
      describePublicDisclosure(disclosure, state, "alice", () => undefined)
    ).toContain("バーストに移動する");
    expect(
      publicDisclosureReferencedCards(disclosure, state, () => undefined)
    ).toHaveLength(2);
  });
  const placementDisclosure = {
    id: "disclosure-placement",
    sequence: 1,
    turnNumber: 1,
    step: "main",
    actorPlayerId: "alice",
    audience: "both",
    kind: "zone_moved",
    targets: [],
    results: [
      {
        kind: "card_move",
        definitionIdSnapshot: "TEST-NEXUS",
        from: "hand",
        to: "field",
        actionLabel: "place",
      },
    ],
  } satisfies PublicDisclosure;
  const summonDisclosure = {
    ...placementDisclosure,
    id: "disclosure-summon",
    results: [
      {
        kind: "card_move",
        definitionIdSnapshot: "BSSA01-C02",
        from: "hand",
        to: "field",
        actionLabel: "summon",
      },
    ],
  } satisfies PublicDisclosure;
  const mirageDisclosure = {
    ...placementDisclosure,
    id: "disclosure-mirage",
    results: [
      {
        kind: "card_move",
        definitionIdSnapshot: "BSGE01-C01",
        from: "hand",
        to: "mirage",
        actionLabel: "mirage_set",
      },
    ],
  } satisfies PublicDisclosure;
  const bulletPlaceDisclosure = {
    ...placementDisclosure,
    id: "disclosure-bullet-place",
    results: [
      {
        kind: "card_move",
        definitionIdSnapshot: "BSGE01-R01",
        from: "hand",
        to: "field",
        actionLabel: "bullet_edit_place",
      },
    ],
  } satisfies PublicDisclosure;
  const bulletSwapDisclosure = {
    ...placementDisclosure,
    id: "disclosure-bullet-swap",
    results: [
      {
        kind: "card_move",
        definitionIdSnapshot: "BSGE01-R01",
        from: "field",
        to: "hand",
        actionLabel: "bullet_edit_swap",
      },
      {
        kind: "card_move",
        definitionIdSnapshot: "BSGE01-R02",
        from: "hand",
        to: "field",
        actionLabel: "bullet_edit_swap",
      },
    ],
  } satisfies PublicDisclosure;
  const bpDisclosure = {
    id: "disclosure-bp",
    sequence: 2,
    turnNumber: 1,
    step: "main",
    actorPlayerId: "alice",
    audience: "both",
    kind: "target_declared",
    targets: [
      {
        kind: "card",
        definitionIdSnapshot: "BSGE01-CX01",
        actionLabel: "bp_modified",
      },
    ],
    results: [],
  } satisfies PublicDisclosure;
  const genericContinuousDisclosure = {
    ...bpDisclosure,
    id: "disclosure-continuous-generic",
    source: {
      definitionIdSnapshot: "CONTINUOUS-SOURCE",
      effectIndex: 0,
    },
    targets: [
      {
        kind: "card",
        definitionIdSnapshot: "BSGE01-CX01",
        actionLabel: "action_execute",
        actionKind: "grant_effect",
      },
    ],
  } satisfies PublicDisclosure;
  const state = { cardInstances: [] } as unknown as GameState;
  const definitions: Record<string, Partial<CardDefinition>> = {
    "TEST-NEXUS": {
      cardNo: "TEST-NEXUS",
      name: "[創界神]カーディナル",
      printedCategory: "nexus",
    },
    "BSSA01-C02": {
      cardNo: "BSSA01-C02",
      name: "ユージオ",
      printedCategory: "spirit",
    },
    "BSGE01-C01": { cardNo: "BSGE01-C01", name: "ティアーストーン" },
    "BSGE01-CX01": {
      cardNo: "BSGE01-CX01",
      name: "神薙 ユウ",
      printedCategory: "spirit",
    },
    "BSGE01-R01": {
      cardNo: "BSGE01-R01",
      name: "アリサ・イリーニチナ・アミエーラ",
      printedCategory: "spirit",
    },
    "BSGE01-R02": {
      cardNo: "BSGE01-R02",
      name: "雨宮 リンドウ",
      printedCategory: "spirit",
    },
    "CONTINUOUS-SOURCE": {
      cardNo: "CONTINUOUS-SOURCE",
      name: "常時効果カード",
      effects: [{ timing: { kind: "continuous" } }],
    } as unknown as Partial<CardDefinition>,
    "TRIGGER-SOURCE": {
      cardNo: "TRIGGER-SOURCE",
      name: "誘発効果カード",
      effects: [{ timing: { kind: "card_event" } }],
    } as unknown as Partial<CardDefinition>,
  };
  const getDefinition = (definitionId: string): CardDefinition | undefined =>
    definitions[definitionId] as CardDefinition | undefined;

  it("uses the explicit field-entry action and identifies the actor", () => {
    expect(
      describePublicDisclosure(
        placementDisclosure,
        state,
        "alice",
        getDefinition
      )
    ).toBe("自分が[創界神]カーディナルを配置する");
    expect(
      describePublicDisclosure(summonDisclosure, state, "alice", getDefinition)
    ).toBe("自分がユージオを召喚する");
    expect(
      describePublicDisclosure(placementDisclosure, state, "bob", getDefinition)
    ).toBe("相手が[創界神]カーディナルを配置する");
  });

  it.each([
    ["move_to_field", "フィールドに出す", "フィールドへ"],
    ["put", "フィールドに出す", "出す"],
    ["genkai", "現界する", "現界"],
    ["advent", "煌臨する", "煌臨"],
    ["contract_combine", "契約合体する", "契約合体"],
    ["manifest", "顕現する", "顕現"],
    ["combine", "合体する", "合体"],
    ["separate", "分離する", "分離"],
    ["rebirth", "転醒する", "転醒"],
    ["flip", "裏返す", "裏返す"],
  ] as const)(
    "%s を召喚に置き換えずログとカード一覧に表示する",
    (actionLabel, text, badge) => {
      const disclosure: PublicDisclosure = {
        ...summonDisclosure,
        results: summonDisclosure.results.map((result) => ({
          ...result,
          actionLabel,
        })),
      };
      expect(
        describePublicDisclosure(disclosure, state, "alice", getDefinition)
      ).toBe(`自分がユージオを${text}`);
      expect(
        publicDisclosureReferencedCards(disclosure, state, getDefinition)[0]
          ?.badgeLabel
      ).toBe(badge);
    }
  );

  it("uses domain-specific wording for mirage, bullet edit, swap, and BP", () => {
    expect(
      describePublicDisclosure(mirageDisclosure, state, "alice", getDefinition)
    ).toBe("自分がティアーストーンをミラージュセットする");
    expect(
      describePublicDisclosure(
        bulletPlaceDisclosure,
        state,
        "alice",
        getDefinition
      )
    ).toBe(
      "自分がアリサ・イリーニチナ・アミエーラをバレットエディットで下に置く"
    );
    expect(
      describePublicDisclosure(
        bulletSwapDisclosure,
        state,
        "alice",
        getDefinition
      )
    ).toBe(
      "自分が雨宮 リンドウをバレットエディットで下に置き、アリサ・イリーニチナ・アミエーラと入れ替える"
    );
    expect(
      describePublicDisclosure(bpDisclosure, state, "alice", getDefinition)
    ).toBe("自分が神薙 ユウのBPを変更する");
  });

  it("数値結果ではカウントの固定・手札増加・BP差分を区別する", () => {
    const disclosure: PublicDisclosure = {
      ...placementDisclosure,
      kind: "state_changed",
      results: [
        {
          kind: "count_delta",
          playerId: "alice",
          amount: -2,
          value: 5,
          actionLabel: "count_set",
        },
        {
          kind: "hand_delta",
          playerId: "alice",
          amount: 1,
          actionLabel: "add_to_hand",
        },
        {
          kind: "bp_delta",
          definitionIdSnapshot: "BSSA01-C02",
          amount: -3000,
          actionLabel: "bp_modified",
        },
      ],
    };
    expect(
      describePublicDisclosure(disclosure, state, "alice", getDefinition)
    ).toBe(
      "自分が自分のカウントを5にする、自分の手札が1枚増加、ユージオのBP-3000"
    );
  });

  it("renders attack, block, battle destruction, and life reduction as concrete sentences", () => {
    const attack = {
      ...placementDisclosure,
      kind: "attack_declared",
      attackId: "attack-1",
      targets: [
        {
          kind: "card",
          definitionIdSnapshot: "BSSA01-C02",
          actionLabel: "attack",
        },
        {
          kind: "player",
          playerId: "bob",
          actionLabel: "attack_target",
        },
      ],
      results: [],
    } satisfies PublicDisclosure;
    const block = {
      ...attack,
      kind: "block_declared",
      actorPlayerId: "bob",
      targets: [
        {
          kind: "card",
          definitionIdSnapshot: "BSGE01-CX01",
          actionLabel: "block",
        },
        {
          kind: "card",
          definitionIdSnapshot: "BSSA01-C02",
          actionLabel: "block_target",
        },
      ],
    } satisfies PublicDisclosure;
    const battle = {
      ...attack,
      kind: "battle_resolved",
      results: [
        {
          kind: "destroyed",
          definitionIdSnapshot: "BSGE01-CX01",
          from: "field",
          to: "trash",
          actionLabel: "destroy",
        },
        {
          kind: "life_delta",
          playerId: "bob",
          amount: -1,
          actionLabel: "life_reduce",
        },
      ],
    } satisfies PublicDisclosure;

    expect(
      describePublicDisclosure(attack, state, "alice", getDefinition)
    ).toBe("自分がユージオで相手にアタック");
    expect(describePublicDisclosure(block, state, "alice", getDefinition)).toBe(
      "相手が神薙 ユウでユージオをブロック"
    );
    expect(
      describePublicDisclosure(battle, state, "alice", getDefinition)
    ).toBe("バトル解決：神薙 ユウを破壊する、相手のライフを1減らす");
  });

  it("hides generic continuous target records from the public log", () => {
    expect(
      isPublicDisclosureLoggable(
        genericContinuousDisclosure,
        state,
        getDefinition
      )
    ).toBe(false);
    expect(isPublicDisclosureLoggable(bpDisclosure, state, getDefinition)).toBe(
      true
    );
  });

  it("extracts log-click browse cards from visible targets/results using immutable snapshots", () => {
    const stateWithLiveTarget = {
      cardInstances: [
        {
          instanceId: "live-target",
          definitionId: "BSGE01-CX01",
          zone: "field",
        },
      ],
    } as unknown as GameState;
    const disclosure = {
      ...bpDisclosure,
      targets: [
        {
          kind: "card",
          instanceId: "live-target",
          definitionIdSnapshot: "BSGE01-CX01",
          actionLabel: "bp_modified",
        },
      ],
      results: [
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R02",
          from: "revealed",
          to: "hand",
          actionLabel: "add_to_hand",
        },
      ],
    } satisfies PublicDisclosure;

    expect(
      publicDisclosureReferencedCards(
        disclosure,
        stateWithLiveTarget,
        getDefinition
      )
    ).toEqual([
      {
        key: "instance:live-target",
        instanceId: "live-target",
        definitionIdSnapshot: "BSGE01-CX01",
        badgeLabel: "BP変更",
        detailStateLabel: "BP変更",
        badgeTone: "neutral",
      },
      {
        key: "snapshot:BSGE01-R02:1",
        definitionIdSnapshot: "BSGE01-R02",
        badgeLabel: "手札へ",
        detailStateLabel: "→手札へ",
        badgeTone: "selected",
      },
    ]);
  });

  it("includes the effect source in log-click browse cards with an activation label", () => {
    const disclosure = {
      ...bpDisclosure,
      source: {
        definitionIdSnapshot: "TRIGGER-SOURCE",
        effectIndex: 0,
      },
      targets: [
        {
          kind: "card",
          definitionIdSnapshot: "BSGE01-CX01",
          actionLabel: "destroy",
        },
      ],
    } satisfies PublicDisclosure;

    expect(
      publicDisclosureReferencedCards(disclosure, state, getDefinition)
    ).toEqual([
      {
        key: "snapshot:TRIGGER-SOURCE:0",
        definitionIdSnapshot: "TRIGGER-SOURCE",
        badgeLabel: "誘発発揮",
        detailStateLabel: "誘発発揮",
        badgeTone: "selected",
      },
      {
        key: "snapshot:BSGE01-CX01:1",
        definitionIdSnapshot: "BSGE01-CX01",
        badgeLabel: "破壊",
        detailStateLabel: "破壊",
        badgeTone: "danger",
      },
    ]);
  });

  it("labels presentation cards with each card outcome", () => {
    const disclosure = {
      ...placementDisclosure,
      kind: "picked",
      results: [
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R02",
          from: "revealed",
          to: "hand",
          actionLabel: "add_to_hand",
        },
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R01",
          from: "revealed",
          to: "deck",
          actionLabel: "move_to_bottom",
          deckPositionSnapshot: "bottom",
          deckIndexFromBottomSnapshot: 0,
          deckCountSnapshot: 20,
        },
        {
          kind: "card_move",
          definitionIdSnapshot: "TEST-NEXUS",
          from: "revealed",
          to: "deck",
          actionLabel: "move_to_top",
          deckPositionSnapshot: "top",
          deckIndexFromBottomSnapshot: 19,
          deckCountSnapshot: 20,
        },
      ],
    } satisfies PublicDisclosure;

    expect(
      publicDisclosurePresentationCards(disclosure, state, getDefinition)
    ).toEqual([
      {
        key: "snapshot:BSGE01-R02:0",
        definitionIdSnapshot: "BSGE01-R02",
        actionLabel: "手札へ",
        tone: "selected",
      },
      {
        key: "snapshot:BSGE01-R01:1",
        definitionIdSnapshot: "BSGE01-R01",
        actionLabel: "デッキ下１",
        tone: "neutral",
      },
      {
        key: "snapshot:TEST-NEXUS:2",
        definitionIdSnapshot: "TEST-NEXUS",
        actionLabel: "デッキ上１",
        tone: "neutral",
      },
    ]);
  });

  it("uses immutable deck placement snapshots instead of result order or current knownDeckCards", () => {
    const disclosure = {
      ...placementDisclosure,
      kind: "zone_moved",
      results: [
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R01",
          from: "revealed",
          to: "deck",
          actionLabel: "move_to_top",
          deckPositionSnapshot: "top",
          deckIndexFromBottomSnapshot: 8,
          deckCountSnapshot: 10,
        },
        {
          kind: "card_move",
          definitionIdSnapshot: "TEST-NEXUS",
          from: "revealed",
          to: "deck",
          actionLabel: "move_to_top",
          deckPositionSnapshot: "top",
          deckIndexFromBottomSnapshot: 9,
          deckCountSnapshot: 10,
        },
      ],
    } satisfies PublicDisclosure;
    const stateAfterShuffle = {
      ...state,
      knownDeckCards: [],
    } as GameState;

    expect(
      publicDisclosurePresentationCards(
        disclosure,
        stateAfterShuffle,
        getDefinition
      ).map((card) => card.actionLabel)
    ).toEqual(["デッキ上２", "デッキ上１"]);
    expect(
      publicDisclosureReferencedCards(
        disclosure,
        stateAfterShuffle,
        getDefinition
      ).map((card) => card.detailStateLabel)
    ).toEqual(["→デッキ上２", "→デッキ上１"]);
  });

  it("shows own and opponent moves while field moves use board animations", () => {
    const opponentPick = {
      ...placementDisclosure,
      kind: "picked",
      actorPlayerId: "alice",
      results: [
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R02",
          from: "revealed",
          to: "hand",
          actionLabel: "add_to_hand",
        },
      ],
    } satisfies PublicDisclosure;
    const ownPick = {
      ...opponentPick,
      actorPlayerId: "bob",
    } satisfies PublicDisclosure;
    const searchRemainder = {
      ...opponentPick,
      id: "search-remainder",
      kind: "zone_moved",
      results: [
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R01",
          from: "revealed",
          to: "deck",
          actionLabel: "move_to_bottom",
        },
      ],
    } satisfies PublicDisclosure;
    const fieldLeave = {
      ...opponentPick,
      id: "field-leave",
      kind: "zone_moved",
      results: [
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R01",
          from: "field",
          to: "trash",
          actionLabel: "destroy",
        },
      ],
    } satisfies PublicDisclosure;

    expect(isPublicDisclosureCardPresentationEligible(opponentPick)).toBe(true);
    expect(isPublicDisclosureCardPresentationEligible(ownPick)).toBe(true);
    expect(isPublicDisclosureCardPresentationEligible(searchRemainder)).toBe(
      true
    );
    expect(isPublicDisclosureCardPresentationEligible(fieldLeave)).toBe(false);
    expect(isPublicDisclosureCardPresentationEligible(bpDisclosure)).toBe(
      false
    );
    expect(publicDisclosureAutoDismissDelay(opponentPick, 1, false)).toBe(
      PUBLIC_DISCLOSURE_PRESENTATION_MS
    );
  });

  it.each([
    ["deck", "trash", "discard", "トラッシュへ"],
    ["hand", "trash", "discard", "トラッシュへ"],
    ["deck", "trash", "move_to_trash", "トラッシュへ"],
    ["revealed", "trash", "move_to_trash", "トラッシュへ"],
    ["trash", "hand", "add_to_hand", "手札へ"],
    ["trash", "deck", "move_to_top", "デッキ上へ"],
    ["trash", "set_aside", "move_to_set_aside", "手元へ"],
    ["trash", "removed_from_game", "move_to_removed", "除外へ"],
    ["removed_from_game", "hand", "add_to_hand", "手札へ"],
  ] as const)(
    "shows %s → %s with its card and destination",
    (from, to, actionLabel, label) => {
      const disclosure: PublicDisclosure = {
        ...placementDisclosure,
        results: [
          {
            kind: "card_move",
            definitionIdSnapshot: "BSGE01-R02",
            from,
            to,
            actionLabel,
          },
        ],
      };
      expect(isPublicDisclosureCardPresentationEligible(disclosure)).toBe(true);
      expect(
        publicDisclosurePresentationCards(disclosure, state, getDefinition)
      ).toMatchObject([
        { definitionIdSnapshot: "BSGE01-R02", actionLabel: label },
      ]);
    }
  );

  it("shows resolved off-field cards in mixed target records without planned, field, or hidden cards", () => {
    const disclosure: PublicDisclosure = {
      ...placementDisclosure,
      kind: "target_declared",
      targets: [
        {
          kind: "card",
          definitionIdSnapshot: "BSGE01-R02",
          actionLabel: "move_to_bottom",
        },
      ],
      results: [
        ...placementDisclosure.results,
        {
          kind: "card_move",
          definitionIdSnapshot: "BSGE01-R02",
          from: "trash",
          to: "hand",
          actionLabel: "add_to_hand",
        },
        {
          kind: "hidden_card_move",
          from: "hand",
          to: "trash",
          count: 1,
          actionLabel: "discard",
        },
        {
          kind: "hand_delta",
          playerId: "alice",
          amount: 1,
          actionLabel: "draw",
        },
      ],
    };
    expect(isPublicDisclosureCardPresentationEligible(disclosure)).toBe(true);
    expect(
      publicDisclosurePresentationCards(disclosure, state, getDefinition)
    ).toMatchObject([
      { definitionIdSnapshot: "BSGE01-R02", actionLabel: "手札へ" },
      { definitionIdSnapshot: "_hidden_card_", actionLabel: "トラッシュへ" },
      { definitionIdSnapshot: "_hidden_card_", actionLabel: "手札へ" },
    ]);
    expect(publicDisclosureAutoDismissDelay(disclosure, 1, false)).toBe(
      PUBLIC_DISCLOSURE_PRESENTATION_MS
    );
    const unresolved = { ...disclosure, results: [] };
    expect(isPublicDisclosureCardPresentationEligible(unresolved)).toBe(false);
    expect(
      publicDisclosurePresentationCards(unresolved, state, getDefinition)
    ).toEqual([]);
  });

  it("keeps open cards visible and never renders an unknown card identity", () => {
    const disclosure: PublicDisclosure = {
      ...placementDisclosure,
      kind: "deck_revealed",
      targets: [
        {
          kind: "card",
          definitionIdSnapshot: "BSGE01-R02",
          actionLabel: "reveal",
        },
      ],
      results: [],
    };
    expect(
      publicDisclosurePresentationCards(disclosure, state, getDefinition)
    ).toMatchObject([
      { definitionIdSnapshot: "BSGE01-R02", actionLabel: "オープン" },
    ]);
    const hidden: PublicDisclosure = {
      ...disclosure,
      kind: "zone_moved",
      targets: [],
      results: [
        {
          kind: "card_move",
          definitionIdSnapshot: "_hidden_card_",
          from: "deck",
          to: "trash",
          actionLabel: "move_to_trash",
        },
      ],
    };
    expect(
      publicDisclosurePresentationCards(hidden, state, getDefinition)
    ).toEqual([]);
  });
});

describe("public disclosure target presentation", () => {
  const targetDisclosure = {
    id: "target-disclosure",
    sequence: 1,
    turnNumber: 1,
    step: "main",
    actorPlayerId: "alice",
    audience: "both",
    kind: "target_declared",
    source: {
      instanceId: "source-card",
      definitionIdSnapshot: "TEST-SOURCE",
      effectIndex: 0,
    },
    targets: [
      {
        kind: "card",
        instanceId: "target-card",
        actionLabel: "bp_modified",
      },
    ],
    results: [],
  } satisfies PublicDisclosure;

  const state = {
    cardInstances: [{ instanceId: "source-card", definitionId: "TEST-SOURCE" }],
  } as unknown as GameState;

  it("draws separated cubic arcs between the source and target card edges", () => {
    const source = {
      instanceId: "source-card",
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      label: "発揮元",
    };
    const target = {
      instanceId: "target-card",
      x: 400,
      y: 100,
      width: 100,
      height: 60,
      label: "破壊する",
    };

    const first = buildPublicDisclosureArrowGeometry(source, target, 0);
    const second = buildPublicDisclosureArrowGeometry(source, target, 1);

    expect(first.path).toMatch(/^M 140\.0 100\.0 C /);
    expect(first.path).toMatch(/ 350\.0 100\.0$/);
    expect(first.control1.y).toBeGreaterThan(first.start.y);
    expect(first.control2.y).toBeGreaterThan(first.end.y);
    expect(first.labelCenter.x).toBeLessThan(first.end.x);
    expect(first.labelCenter.x).toBeGreaterThan(first.start.x);
    expect(second.control1.y).toBeGreaterThan(first.control1.y);
    expect(second.path).not.toBe(first.path);
  });

  it("excludes always-on continuous target declarations from board animation", () => {
    const getDefinition = (definitionId: string): CardDefinition | undefined =>
      definitionId === "TEST-SOURCE"
        ? ({
            cardNo: definitionId,
            name: "常時効果カード",
            effects: [{ timing: { kind: "continuous" } }],
          } as unknown as CardDefinition)
        : undefined;

    expect(
      isContinuousTargetDisclosure(targetDisclosure, state, getDefinition)
    ).toBe(true);
  });

  it("keeps immediate continuous-effect applications dismissible when only unrelated actions exist", () => {
    const getDefinition = (definitionId: string): CardDefinition | undefined =>
      definitionId === "TEST-SOURCE"
        ? ({
            cardNo: definitionId,
            name: "即時発揮カード",
            effects: [{ timing: { kind: "card_event" } }],
          } as unknown as CardDefinition)
        : undefined;
    const unrelatedAction = {
      kind: "summon",
      actionId: "summon-1",
      can: true,
      sourceInstanceId: "hand-card",
    } as unknown as LegalAction;

    expect(
      isContinuousTargetDisclosure(targetDisclosure, state, getDefinition)
    ).toBe(false);
    expect(
      hasPublicDisclosureEffectTreeLegalAction(targetDisclosure, state, [
        unrelatedAction,
      ])
    ).toBe(false);
    expect(publicDisclosureAutoDismissDelay(targetDisclosure, 1, false)).toBe(
      PUBLIC_DISCLOSURE_ARROW_PRESENTATION_MS
    );
    expect(publicDisclosureAutoDismissDelay(targetDisclosure, 3, false)).toBe(
      PUBLIC_DISCLOSURE_ARROW_PRESENTATION_MS
    );
  });

  it("holds the timer only while an action belongs to the same effect tree", () => {
    const stateWithContinuation = {
      ...state,
      pendingTargetedDisclosureContinuation: {
        pendingId: "targeted-1",
        sourceInstanceId: "source-card",
        sourceDefinitionId: "TEST-SOURCE",
        effectIndex: 0,
      },
    } as unknown as GameState;
    const relatedAction = {
      kind: "resolve_pending_effect_target",
      actionId: "resolve-1",
      can: true,
      pendingId: "targeted-1",
    } as unknown as LegalAction;

    expect(
      hasPublicDisclosureEffectTreeLegalAction(
        targetDisclosure,
        stateWithContinuation,
        [relatedAction]
      )
    ).toBe(true);
    expect(publicDisclosureAutoDismissDelay(targetDisclosure, 1, true)).toBe(
      null
    );
  });
});
