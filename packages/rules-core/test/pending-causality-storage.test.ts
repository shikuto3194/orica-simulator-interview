import ts from "typescript";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyGameState, type GameState } from "../src";
import {
  assertPendingTriggerChainIds,
  pendingResolutionContexts,
  pendingTriggerChainEntries,
} from "../src/chain-id";
import { hasPendingBattleEndFinalizeBlockers } from "../src/battle/battle-end-finalize-blockers";

// 実装の列挙表を複写せず、公開モデルから独立に保存経路を抽出する。
// GameState（過去の盤面）と再帰型の2周目は走査しない。
const file = fileURLToPath(new URL("../src/model.ts", import.meta.url));
const program = ts.createProgram([file], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const model = program.getSourceFile(file)!;
const stateNode = model.statements.find(
  (node): node is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(node) && node.name.text === "GameState"
)!;
const stateType = checker.getTypeAtLocation(stateNode);
type Path = (string | number)[];
const paths = new Map<string, { path: Path; key: string }>();
for (const root of stateType
  .getProperties()
  .filter(
    (p) =>
      p.name.startsWith("pending") ||
      ["stackWindow", "activeAttack"].includes(p.name)
  )) {
  const visited = new Set<ts.Type>();
  const walk = (raw: ts.Type, path: Path): void => {
    const type = checker.getNonNullableType(raw);
    if (type === stateType || visited.has(type)) return;
    // カード本文は実行待ちの状態ではない。Action に内包された型もここで除外する。
    if (
      type
        .getSymbol()
        ?.declarations?.some((node) =>
          node.getSourceFile().fileName.endsWith("dsl-types.ts")
        )
    )
      return;
    visited.add(type);
    try {
      if (type.isUnion()) {
        for (const sub of type.types) walk(sub, path);
        return;
      }
      if (checker.isArrayType(type) || checker.isTupleType(type)) {
        const item = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
        if (item) walk(item, [...path, 0]);
        return;
      }
      if (!(type.flags & ts.TypeFlags.Object)) return;
      for (const key of type.getProperties()) {
        const node = key.valueDeclaration ?? key.declarations?.[0];
        if (!node) continue;
        if (
          [
            "chainId",
            "battleEndDeferralAttackId",
            "waitChainId",
            "effectSummonChainId",
          ].includes(key.name)
        ) {
          paths.set(JSON.stringify([...path, key.name]), {
            path,
            key: key.name,
          });
        } else if (
          node
            .getSourceFile()
            .fileName.replaceAll("\\", "/")
            .includes("/rules-core/src/")
        ) {
          walk(checker.getTypeOfSymbolAtLocation(key, node), [
            ...path,
            key.name,
          ]);
        }
      }
    } finally {
      // 同じ型の別の保存先も調べる。省くのは今の祖先への再帰だけ。
      visited.delete(type);
    }
  };
  walk(checker.getTypeOfSymbolAtLocation(root, root.valueDeclaration!), [
    root.name,
  ]);
}

function fixture(path: Path, key: string, value: string): GameState {
  const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
  let cursor = state as unknown as Record<string | number, unknown>;
  path.forEach((part, i) => {
    const child = typeof path[i + 1] === "number" ? [] : {};
    cursor[part] = child;
    cursor = child as unknown as Record<string | number, unknown>;
  });
  cursor[key] = value;
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function setAtPath(state: GameState, path: string, value: unknown) {
  const parts = path.replaceAll(/\[(\d+)\]/g, ".$1").split(".");
  let cursor = state as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1))
    cursor = cursor[part] as Record<string, unknown>;
  cursor[parts.at(-1)!] = value;
}

describe("保存可能な全原因文脈（モデルから抽出）", () => {
  for (const { path, key } of paths.values()) {
    const label = path
      .map((p, i) => (typeof p === "number" ? `[${p}]` : `${i ? "." : ""}${p}`))
      .join("");
    it(`${label}.${key}`, () => {
      const state = fixture(
        path,
        key,
        key === "battleEndDeferralAttackId"
          ? "audit"
          : "battle-end-deferral:audit:outer:child"
      );
      expect(
        pendingResolutionContexts(state).some((entry) => entry.path === label),
        "生きた再開文脈を走査する"
      ).toBe(true);
      if (key !== "battleEndDeferralAttackId") {
        expect(
          pendingTriggerChainEntries(state).some(
            (entry) => entry.path === `${label}.${key}`
          ),
          "原因IDの検査を通る"
        ).toBe(true);
        // 最小fixtureの祖先にも適法なIDを入れて、問題の経路自身が拒否されることを確認。
        for (const entry of pendingTriggerChainEntries(state))
          setAtPath(state, entry.path, "battle-end-deferral:audit:outer:child");
        expect(() => assertPendingTriggerChainIds(state)).not.toThrow();
        for (const invalid of ["", " ", null, undefined]) {
          setAtPath(state, `${label}.${key}`, invalid);
          expect(() => assertPendingTriggerChainIds(state)).toThrow(
            `${label}.${key}`
          );
        }
        setAtPath(
          state,
          `${label}.${key}`,
          "battle-end-deferral:audit:outer:child"
        );
      }
      expect(
        hasPendingBattleEndFinalizeBlockers(state, "audit"),
        "入力待ちは寿命を保持し、解決済みスタックの窓内履歴は保持しない"
      ).toBe(
        ![
          "activeAttack",
          "stackWindow",
          "pendingStackCascadeFlushGuardStacks",
          "pendingLeaveEntities",
          "pendingAttackStepEndFinalizations",
        ].includes(String(path[0]))
      );
      expect(
        hasPendingBattleEndFinalizeBlockers(state, "other"),
        "別のバトルは拘束しない"
      ).toBe(false);
    });
  }
});
