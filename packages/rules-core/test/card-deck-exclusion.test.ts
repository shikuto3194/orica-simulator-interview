import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardZone } from "../src/model";
import type { DSL } from "../src/dsl-types";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { moveCardZone, updateCard } from "../src/core/core-system";
import { executeMoveCard } from "../src/effect/native-move-core-handlers";
import { createStepExecutionContext } from "../src/step-execution-context";
import {
  moveUninstantiatedCards,
  replaceCardInstances,
} from "../src/zone/card-instance-state";
import { queuePendingLeave } from "../src/state-based-actions";
import ts from "typescript";
import { resolve } from "node:path";

/** Walk every nested action, including back faces, divine skills and choices. */
function cardMoves(
  value: unknown,
  path = ""
): { path: string; action: Record<string, unknown> }[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => cardMoves(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [
    ...(object.kind === "move_card" ? [{ path, action: object }] : []),
    ...Object.entries(object).flatMap(([key, item]) =>
      cardMoves(item, `${path}.${key}`)
    ),
  ];
}

function cardDestinations(
  value: unknown,
  path = ""
): { path: string; zone: unknown }[] {
  if (Array.isArray(value))
    return value.flatMap((item, i) => cardDestinations(item, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const own: { path: string; zone: unknown }[] = [];
  if (object.kind === "move_card")
    own.push({
      path: `${path}.to.zone`,
      zone: (object.to as { zone?: unknown } | undefined)?.zone,
    });
  if (object.kind === "move_self" || object.kind === "search_zone")
    own.push({ path: `${path}.destination`, zone: object.destination });
  if (object.kind === "borrow_magic_effect")
    for (const field of ["beforeMove", "thenMove"])
      if (object[field])
        own.push({
          path: `${path}.${field}.zone`,
          zone: (object[field] as { zone?: unknown }).zone,
        });
  const disposition = object.cardEventDisposition as
    | { kind?: string; destination?: unknown }
    | undefined;
  if (disposition?.kind === "move")
    own.push({
      path: `${path}.cardEventDisposition.destination`,
      zone: disposition.destination,
    });
  return [
    ...own,
    ...Object.entries(object).flatMap(([key, item]) =>
      cardDestinations(item, `${path}.${key}`)
    ),
  ];
}

describe("カードデータ全件のデッキ除外先", () => {
  it("全カードと裏面・ネスト内のmove_cardは移動元を問わずvoidへ移動しない", () => {
    const moves = ALL_CARDS.flatMap((card) => cardMoves(card, card.cardNo));
    expect(moves.length).toBeGreaterThan(0);
    expect(
      moves
        .filter(
          ({ action }) =>
            (action.to as { zone?: string } | undefined)?.zone === "void"
        )
        .map(({ path }) => path)
    ).toEqual([]);
    expect(
      ALL_CARDS.flatMap((card) => cardDestinations(card, card.cardNo))
        .filter((entry) => entry.zone === "void")
        .map((entry) => entry.path)
    ).toEqual([]);
  });

  it("カード移動型はvoidを拒否し、低層移動も未型付け入力を状態変更前に拒否する", () => {
    // Invalid untyped inputs must also fail at runtime.
    // @ts-expect-error void is a core destination, never a card destination.
    const badZone: CardZone = "void";
    // @ts-expect-error DSL card movement cannot encode void either.
    const badTo: DSL.MoveCardAction["to"] = { zone: "void" };
    expect(badTo.zone).toBe(badZone);
    const card = createCardInstance(ALL_CARDS[0]!, {
      instanceId: "guard-card",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [card],
    };
    const before = structuredClone(state);
    expect(() => moveCardZone(state, card.instanceId, badZone)).toThrow(
      "Cards cannot move to void"
    );
    expect(state.cardInstances[0]!.zone).toBe("hand");
    expect(state).toEqual(before);
    expect(() =>
      replaceCardInstances(state, [{ ...card, zone: badZone }])
    ).toThrow("Cards cannot move to void");
    expect(() =>
      updateCard(state, card.instanceId, (current) => ({
        ...current,
        zone: badZone,
      }))
    ).toThrow("Cards cannot move to void");
    expect(state).toEqual(before);
  });

  it("実TypeScriptコンパイラがDSLと低層移動のvoidを拒否しcore_moveは受理する", () => {
    const filename = resolve(
      "packages/rules-core/test/card-zone-type-contract.ts"
    );
    const source = `
      import type { DSL } from "../src/dsl-types";
      import type { CardZone, GameState } from "../src/model";
      import { moveCardZone } from "../src/core/core-system";
      import { moveUninstantiatedCards } from "../src/zone/card-instance-state";
      import { queuePendingLeave } from "../src/state-based-actions";
      declare const state: GameState;
      // @ts-expect-error card zones exclude void
      const zone: CardZone = "void";
      // @ts-expect-error card DSL destinations exclude void
      const to: DSL.MoveCardAction["to"] = { zone: "void" };
      // @ts-expect-error search cannot normalize a void request into a different card move
      const searchTo: DSL.SearchZoneAction["destination"] = "void";
      // @ts-expect-error borrowed cleanup remains a card destination even when deferred
      const cleanup: NonNullable<DSL.BorrowMagicEffectAction["thenMove"]> = { zone: "void" };
      // @ts-expect-error low-level card movement excludes void
      moveCardZone(state, "card", "void");
      // @ts-expect-error abstract card movement also excludes void
      moveUninstantiatedCards(state, "alice", "deck", "void", 1);
      // @ts-expect-error pending field exits cannot encode void
      const leave: Parameters<typeof queuePendingLeave>[0]["leaveDestination"] = { zone: "void" };
      const coreTo: DSL.CoreMoveAction["to"] = { kind: "void", player: "self" };
      void zone; void to; void searchTo; void cleanup; void coreTo; void leave;
    `;
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      esModuleInterop: true,
    };
    const host = ts.createCompilerHost(options);
    const originalGetSource = host.getSourceFile.bind(host);
    host.getSourceFile = (file, languageVersion, ...rest) =>
      resolve(file) === filename
        ? ts.createSourceFile(file, source, languageVersion, true)
        : originalGetSource(file, languageVersion, ...rest);
    const program = ts.createProgram([filename], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      )
    ).toEqual([]);
  }, 30000);

  it("未型付けmove_cardのvoidを候補抽選・場の離脱・hidden deck更新より先に拒否する", () => {
    for (const zone of ["hand", "field", "deck"] as const) {
      const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
      if (zone !== "deck")
        state.cardInstances = [
          createCardInstance(ALL_CARDS[0]!, {
            instanceId: "card",
            ownerPlayerId: "alice",
            zone,
          }),
        ];
      const action = {
        kind: "move_card",
        from: { zone, player: "self" },
        to: { zone: "void" },
        count: 1,
      } as unknown as DSL.MoveCardAction;
      const before = structuredClone(state);
      expect(() =>
        executeMoveCard(
          action,
          state,
          "alice",
          "card",
          () => ALL_CARDS[0],
          createStepExecutionContext(state)
        )
      ).toThrow("Cards cannot move to void");
      expect(state).toEqual(before);
    }
  });

  it("抽象デッキ移動と場の離脱キューもvoidを状態変更前に拒否する", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    state.cardInstances = [
      createCardInstance(ALL_CARDS[0]!, {
        instanceId: "field-card",
        ownerPlayerId: "alice",
        zone: "field",
      }),
    ];
    const before = structuredClone(state);
    expect(() =>
      moveUninstantiatedCards(state, "alice", "deck", "void" as CardZone, 1)
    ).toThrow("Cards cannot move to void");
    expect(() =>
      queuePendingLeave({
        state,
        instanceId: "field-card",
        kind: "bounce",
        cause: "effect_resolution",
        chainId: "guard",
        leaveDestination: { zone: "void" as CardZone },
      })
    ).toThrow("Cards cannot move to void");
    expect(state).toEqual(before);
  });

  it("C01の2効果とM04の直接除外はremoved_from_gameでありdeckDiscardを持たない", () => {
    for (const [no, indices] of [
      ["BSTH05.5-C01", [1, 2]],
      ["BSTH05.5-M04", [2]],
    ] as const) {
      const card = ALL_CARDS.find((entry) => entry.cardNo === no)!;
      const moves = indices.flatMap((index) => cardMoves(card.effects![index]));
      expect(moves).toHaveLength(indices.length);
      for (const { action } of moves) {
        expect(action.to).toEqual({ zone: "removed_from_game" });
        expect(action).not.toHaveProperty("deckDiscard");
      }
    }
  });
});
