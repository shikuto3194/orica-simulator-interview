// P3-170 W5: GameState を内包する型の「型グラフ」を TypeScript の型情報から導出する。
//
// 旧形式の使用会計 migration (packages/rules-core/src/effect-usage/migration.ts) は、生JSONを
// 汎用再帰せず、この型グラフ (src/effect-usage/nested-states.ts に生成して置く) だけを訪問する。
// このモジュールは
//   1. GameState から到達できる型のうち、(a) GameState を直接/間接に内包する型、
//      (b) 使用会計の運搬フィールド (recordedUsage / refundableUsage / normalHandPlayRollback) を持つ型
//      を列挙し、
//   2. 生成物 (nested-states.ts) の TypeScript ソースを描画する。
// 生成物と型グラフが食い違ったら test/effect-usage-nested-states.test.ts が落ちる。
// 再生成: node scripts/generate-effect-usage-nested-states.mjs
import ts from "typescript";
import path from "node:path";

/** 使用会計の運搬フィールド名 (新モデルの名前)。 */
export const CARRIER_PROPS = [
  "normalHandPlayRollback",
  "recordedUsage",
  "refundableUsage",
];

const SKIP_FLAGS =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Never |
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.TypeParameter;

const TRANSPARENT_ALIASES = [
  "Pick",
  "Omit",
  "Partial",
  "Required",
  "Readonly",
  "Record",
];

/**
 * @param {string} root リポジトリルート
 * @returns {Record<string, {edges: {prop: string, array: boolean, targets: string[]}[], carriers: string[]}>}
 */
export function buildNestedStateGraph(root) {
  const configPath = path.join(root, "packages/rules-core/tsconfig.json");
  const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    cfg.config,
    ts.sys,
    path.dirname(configPath)
  );
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const checker = program.getTypeChecker();
  const modelFile = program.getSourceFile(
    path.join(root, "packages/rules-core/src/model.ts")
  );
  let gameStateType;
  ts.forEachChild(modelFile, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === "GameState") {
      gameStateType = checker.getTypeAtLocation(n.name);
    }
  });
  if (!gameStateType) throw new Error("GameState interface not found");

  const carrierProps = new Set(CARRIER_PROPS);
  const isGameState = (t) => t === gameStateType;

  /** 型を (配列か, 要素型) の列へ展開する。union / 配列を透過する。 */
  function unwrap(type) {
    const out = [];
    const visit = (t, array) => {
      if (t.isUnion()) {
        for (const u of t.types) visit(u, array);
        return;
      }
      if (checker.isArrayType(t) || checker.isTupleType(t)) {
        for (const a of checker.getTypeArguments(t)) visit(a, true);
        return;
      }
      out.push({ type: t, array });
    };
    visit(type, false);
    return out;
  }

  const nodes = new Map();
  const queue = [];
  function nameOf(type, hint) {
    const sym = type.aliasSymbol ?? type.getSymbol();
    const n = sym?.getName();
    if (n && n !== "__type" && n !== "__object") return n;
    return hint;
  }
  function register(type, hint) {
    if (nodes.has(type)) return nodes.get(type);
    const node = { name: nameOf(type, hint), edges: [], carriers: [], type };
    nodes.set(type, node);
    queue.push(node);
    return node;
  }
  register(gameStateType, "GameState");
  while (queue.length > 0) {
    const node = queue.shift();
    for (const p of node.type.getProperties()) {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      if (!decl) continue;
      if (carrierProps.has(p.getName())) node.carriers.push(p.getName());
      for (const { type: ct, array } of unwrap(checker.getTypeOfSymbol(p))) {
        if (isGameState(ct)) {
          node.edges.push({ prop: p.getName(), array, target: gameStateType });
          continue;
        }
        if (ct.flags & SKIP_FLAGS) continue;
        if (!(ct.flags & ts.TypeFlags.Object) && !ct.isIntersection()) continue;
        if (ct.getCallSignatures().length > 0) continue;
        const sym = ct.getSymbol();
        const sf = sym?.declarations?.[0]?.getSourceFile();
        const alias = ct.aliasSymbol?.getName() ?? "";
        if (
          sf &&
          /node_modules|lib\.[a-z.]*\.d\.ts/.test(sf.fileName) &&
          !TRANSPARENT_ALIASES.includes(alias)
        ) {
          continue;
        }
        register(ct, `${node.name}.${p.getName()}`);
        node.edges.push({ prop: p.getName(), array, target: ct });
      }
    }
  }

  // GameState を内包する、または運搬フィールドを持つ型を不動点で求める。
  const relevant = new Map();
  for (const [t, n] of nodes) {
    relevant.set(
      t,
      n.carriers.length > 0 || n.edges.some((e) => isGameState(e.target))
    );
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [t, n] of nodes) {
      if (relevant.get(t)) continue;
      if (n.edges.some((e) => relevant.get(e.target))) {
        relevant.set(t, true);
        changed = true;
      }
    }
  }

  // 同名ノードを統合する (union の各メンバは実行時に区別せず、持つ辺をすべて辿る)。
  const nameFor = (t) => (isGameState(t) ? "GameState" : nodes.get(t).name);
  const merged = new Map();
  for (const [t, n] of nodes) {
    if (!relevant.get(t)) continue;
    const name = nameFor(t);
    const m = merged.get(name) ?? { edges: new Map(), carriers: new Set() };
    merged.set(name, m);
    for (const c of n.carriers) m.carriers.add(c);
    for (const e of n.edges) {
      if (!(isGameState(e.target) || relevant.get(e.target))) continue;
      const key = e.prop;
      const entry = m.edges.get(key) ?? {
        prop: e.prop,
        array: false,
        targets: new Set(),
      };
      entry.targets.add(nameFor(e.target));
      entry.array = entry.array || e.array;
      m.edges.set(key, entry);
    }
  }
  const out = {};
  for (const name of [...merged.keys()].sort()) {
    const m = merged.get(name);
    out[name] = {
      edges: [...m.edges.values()]
        .map((e) => ({
          prop: e.prop,
          array: e.array,
          targets: [...e.targets].sort(),
        }))
        .sort((a, b) => (a.prop < b.prop ? -1 : a.prop > b.prop ? 1 : 0)),
      carriers: [...m.carriers].sort(),
    };
  }
  return out;
}

/** 型グラフを nested-states.ts のソースへ描画する。整形は prettier に任せる。 */
export function renderNestedStateTable(graph) {
  const lines = [];
  lines.push(
    `/**
 * GameState を内包する型の「型グラフ」(生成物。手で編集しない)。
 *
 * 旧形式の使用会計 migration (migration.ts) が、入れ子の GameState (priorStateSnapshot /
 * effectResolutionBeforeState / resumePreviousStepPreState / originalState / beforeState /
 * triggerBeforeState …) と、使用会計の運搬フィールド (recordedUsage / refundableUsage /
 * normalHandPlayRollback) を訪問するために使う。生JSONを汎用再帰して field 名が似たものを
 * 変換しないよう、model.ts の型から導出した「親型 → フィールド → 子型」だけを辿る。
 *
 * 生成: node scripts/generate-effect-usage-nested-states.mjs
 * 検証: test/effect-usage-nested-states.test.ts が model.ts の型から再導出して一致を確認する。
 */

export type NestedStateCarrier =
  | "normalHandPlayRollback"
  | "recordedUsage"
  | "refundableUsage";

export interface NestedStateEdge {
  /** 親型のフィールド名。 */
  readonly prop: string;
  /** 配列フィールドか。 */
  readonly array: boolean;
  /** 子型の名前 (NESTED_STATE_GRAPH のキー)。union は複数。 */
  readonly targets: readonly string[];
}

export interface NestedStateNode {
  readonly edges: readonly NestedStateEdge[];
  /** この型が持つ使用会計の運搬フィールド。 */
  readonly carriers: readonly NestedStateCarrier[];
}

/** 型名 → その型が持つ辺。"GameState" が根 (入れ子の GameState も同じ型)。 */
export const NESTED_STATE_GRAPH: Readonly<Record<string, NestedStateNode>> = {`
  );
  for (const [name, node] of Object.entries(graph)) {
    const edges = node.edges
      .map(
        (e) =>
          `{ prop: ${JSON.stringify(e.prop)}, array: ${e.array}, targets: ${JSON.stringify(e.targets)} }`
      )
      .join(", ");
    lines.push(
      `  ${JSON.stringify(name)}: { edges: [${edges}], carriers: ${JSON.stringify(node.carriers)} },`
    );
  }
  lines.push("};", "");
  return lines.join("\n");
}
