import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";

type Node = Record<string, unknown>;

/** Compare source-only alternatives while retaining count, price, destination and branch conditions. */
function sourceIndependentBranch(branch: Node) {
  const copy = structuredClone(branch);
  delete copy.choice;
  delete copy.id;
  delete copy.label;
  delete copy.connector;
  const action = copy.action as Node | undefined;
  if (!action) return null;
  const target = action.target as Node | undefined;
  const from = action.from as Node | undefined;
  let source: unknown;
  if (action.kind === "core_move") {
    source = [action.from, action.target];
    delete action.from;
    delete action.target;
    const to = action.to as Node | undefined;
    if (to?.kind === "void") delete to.player;
  } else if (target && ["from_zone", "filter"].includes(String(target.kind))) {
    source = [target.zone, target.includeSoulState, target.includeAdventSource];
    delete target.zone;
    delete target.includeSoulState;
    delete target.includeAdventSource;
    const filter = target.filter as Node | undefined;
    if (filter?.soulState === "only") delete filter.soulState;
  } else if (from?.zone !== undefined) {
    source = from.zone;
    delete from.zone;
  } else if (action.fromZone !== undefined || action.kind === "search_zone") {
    source = action.fromZone ?? action.zone;
    delete action.fromZone;
    delete action.zone;
  } else return null;
  return { branch: canonical(copy), source: JSON.stringify(source) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

it("all card faces and nested effects keep source-zone alternatives in one target selection", () => {
  const violations: string[] = [];
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== "object") return;
    const node = value as Node;
    if (Array.isArray(node.choice)) {
      const branches = [node, ...(node.choice as Node[])].map(
        sourceIndependentBranch
      );
      for (let i = 0; i < branches.length; i++) {
        for (let j = i + 1; j < branches.length; j++) {
          const a = branches[i],
            b = branches[j];
          if (a && b && a.branch === b.branch && a.source !== b.source) {
            violations.push(`${path}: choices ${i}/${j}`);
          }
        }
      }
    }
    for (const [key, child] of Object.entries(node))
      visit(child, `${path}.${key}`);
  }
  for (const card of ALL_CARDS) visit(card, card.cardNo);
  expect(violations).toEqual([]);
});
