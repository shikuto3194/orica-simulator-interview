// カードファイルの各カードに effectsV2 フィールドを追加するスクリプト
// Usage: node scripts/add-v2-effects.js <filename>
// Example: node scripts/add-v2-effects.js BSTH02.ts

const fs = require("fs");
const path = require("path");

const targetFile = process.argv[2];
if (!targetFile) {
  console.error("Usage: node scripts/add-v2-effects.js <filename>");
  console.error("Example: node scripts/add-v2-effects.js BSTH02.ts");
  process.exit(1);
}

const inputFile = path.resolve(__dirname, "../src/cards", targetFile);
if (!fs.existsSync(inputFile)) {
  console.error("File not found:", inputFile);
  process.exit(1);
}
let content = fs.readFileSync(inputFile, "utf-8");

function convertTarget(target) {
  if (!target) return { kind: "self" };
  if (target.selfCard) return { kind: "self" };
  const filter = {};
  if (target.category) filter.category = target.category;
  if (target.colors) filter.colors = target.colors;
  if (target.tribes) filter.tribes = target.tribes;
  if (target.tribesLogic) filter.tribesLogic = target.tribesLogic;
  if (target.tribesRequired) filter.tribesRequired = target.tribesRequired;
  if (target.maxCost !== undefined) filter.maxCost = target.maxCost;
  if (target.minCost !== undefined) filter.minCost = target.minCost;
  if (target.maxBp !== undefined) filter.maxBp = target.maxBp;
  if (target.cardNames)
    filter.cardName = target.cardNames.map((n) => ({ exact: n }));
  if (target.includeSoulState) filter.soulState = "include";
  return {
    kind: "filter",
    player: target.player || "self",
    filter,
    count: target.count === -1 ? "all" : target.count || 1,
  };
}

function convertInlineFilter(f) {
  const r = {};
  if (f.category) r.category = f.category;
  if (f.colors) r.colors = f.colors;
  if (f.tribes) r.tribes = f.tribes;
  if (f.tribesLogic) r.tribesLogic = f.tribesLogic;
  if (f.maxCost !== undefined) r.maxCost = f.maxCost;
  if (f.minCost !== undefined) r.minCost = f.minCost;
  return r;
}

function convertAction(a) {
  switch (a.kind) {
    case "destroy":
    case "vanish":
    case "remove_from_game":
    case "recover":
      return { kind: a.kind, target: convertTarget(a.target) };
    case "bounce":
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        ...(a.maxPreventable !== undefined
          ? { maxPreventable: a.maxPreventable }
          : {}),
      };
    case "send_to_deck":
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        position: a.position || "bottom",
        ...(a.maxPreventable !== undefined
          ? { maxPreventable: a.maxPreventable }
          : {}),
      };
    case "exhaust":
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        ...(a.targetState === "heavily_exhausted"
          ? { degree: "heavy_exhaust" }
          : {}),
      };
    case "bp_modify":
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        amount: a.amount,
        duration: a.duration,
      };
    case "symbol_add":
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        symbol: a.symbol,
        duration: a.duration,
      };
    case "effect_immunity":
    case "unblockable":
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        duration: a.duration,
      };
    case "effect_resistance": {
      const m = {
        cannot_leave_field: "leave_field",
        cannot_be_destroyed: "destroy",
        cannot_be_bounced: "bounce",
        cannot_be_sent_to_deck: "send_to_deck",
        cannot_be_vanished: "vanish",
        cannot_be_removed_from_game: "remove_from_game",
      };
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        resistsOutcome: m[a.resistType] || "leave_field",
        source: "opponent_effect",
        duration: a.duration,
      };
    }
    case "prevent_battle":
      return {
        kind: a.kind,
        target: convertTarget(a.target),
        restriction:
          a.restriction === "both" ? ["attack", "block"] : [a.restriction],
        duration: a.duration,
      };
    case "prevent_attack":
      return {
        kind: "prevent_battle",
        target: convertTarget(a.target),
        restriction: ["attack"],
        duration: a.duration,
      };
    case "draw":
      return { kind: a.kind, count: a.count };
    case "core_move":
      return { kind: a.kind, from: a.from, to: a.to, amount: a.amount };
    case "life_damage":
      return { kind: a.kind, player: a.player, amount: a.amount };
    case "life_fill":
      return { kind: a.kind, player: a.player, targetValue: a.targetValue };
    case "count_increase":
      return { kind: a.kind, player: a.player, amount: a.amount };
    case "count_decrease":
      return {
        kind: "count_increase",
        player: a.player,
        amount: -(a.amount || 1),
      };
    case "prevent_life_damage":
      return { kind: a.kind, player: a.player, duration: a.duration };
    case "draw_modify":
      return { kind: a.kind, amount: a.amount, duration: a.duration };
    case "end_attack_step":
    case "additional_attack":
    case "rebirth":
      return { kind: a.kind };
    case "restrict_flash":
      return { kind: a.kind, player: a.player, duration: a.duration };
    case "negate":
      return {
        kind: a.kind,
        negateTarget: a.negateTarget,
        ...(a.targetFilter ? { targetFilter: a.targetFilter } : {}),
      };
    case "treat_as": {
      const am = {
        color: ["color"],
        symbol: ["symbol"],
        reduction_symbol: ["reduction_symbol"],
        color_and_symbol: ["color", "symbol"],
        symbol_and_reduction: ["symbol", "reduction_symbol"],
      };
      return {
        kind: a.kind,
        aspects: am[a.aspect] || ["symbol"],
        asColor: a.asColor,
        ...(a.appliesToCard ? { appliesToCard: a.appliesToCard } : {}),
      };
    }
    case "additional_cost":
      return {
        kind: "cost_modify",
        player: "self",
        modifier: { additionalCostValue: a.additionalCost },
      };
    case "cost_override":
      return {
        kind: "cost_modify",
        player: a.player || "self",
        ...(a.filter ? { cardFilter: convertInlineFilter(a.filter) } : {}),
        modifier: a.costOverride === 0 ? "free" : { override: a.costOverride },
        ...(a.duration ? { duration: a.duration } : {}),
      };
    case "deck_reveal":
      return {
        kind: a.kind,
        revealCount: a.revealCount,
        picks: a.picks.map((p) => ({
          count: p.count,
          ...(p.filter ? { filter: convertInlineFilter(p.filter) } : {}),
          ...(p.filterOr
            ? { filter: { filterOr: p.filterOr.map(convertInlineFilter) } }
            : {}),
          ...(p.destination ? { destination: p.destination } : {}),
        })),
        remainder: a.remainder || "bottom",
      };
    case "search_deck":
      return {
        kind: "search_zone",
        zone: "deck",
        ...(a.filter ? { filter: convertInlineFilter(a.filter) } : {}),
        count: a.count || 1,
        destination: a.destination || "hand",
      };
    case "return_from_trash":
      return {
        kind: "search_zone",
        zone: "trash",
        ...(a.filter ? { filter: convertInlineFilter(a.filter) } : {}),
        count: a.count || 1,
        destination: a.destination || "hand",
      };
    case "discard_hand":
      return {
        kind: "discard",
        count: a.count || 1,
        ...(a.player ? { player: a.player } : {}),
        ...(a.filter ? { filter: convertInlineFilter(a.filter) } : {}),
      };
    case "summon":
      if (a.summonType === "self" || a.summonType === "self_from_hand")
        return {
          kind: a.kind,
          target: { kind: "self" },
          ...(a.costModifier ? { costModifier: a.costModifier } : {}),
        };
      return {
        kind: a.kind,
        target: {
          kind: "from_zone",
          zone: a.zone || "hand",
          ...(a.filter ? { filter: convertInlineFilter(a.filter) } : {}),
          count: a.count || 1,
        },
        ...(a.costModifier ? { costModifier: a.costModifier } : {}),
      };
    case "move_to_set_aside":
      return {
        kind: "move_card",
        from: {
          zone: a.fromZone || "trash",
          player: a.player || "self",
          ...(a.filter ? { filter: convertInlineFilter(a.filter) } : {}),
        },
        to: { zone: "set_aside" },
        count: a.count || 1,
      };
    default:
      return a;
  }
}

function convertEffect(e) {
  const steps = [];
  for (let i = 0; i < e.actions.length; i++) {
    const c = convertAction(e.actions[i]);
    if (!c) continue;
    steps.push({ action: c, ...(i > 0 ? { connector: "simultaneous" } : {}) });
  }
  const r = {};
  if (e.timing) r.timing = e.timing;
  if (e.condition) r.condition = e.condition;
  if (e.executionMode) r.executionMode = e.executionMode;
  if (e.usageLimit) r.usageLimit = e.usageLimit;
  if (e.activationCost) r.activationCost = e.activationCost;
  r.steps = steps;
  if (e.textRef) r.textRef = e.textRef;
  if (e.stub) r.stub = e.stub;
  return r;
}

// TypeScript を eval 可能に加工
const cleanContent = content
  .replace(/^import.*$/gm, "")
  .replace(/export const \w+:\s*\w+\[\]\s*=/, "var cards =");

var cards; // eslint-disable-line no-unassigned-vars -- assigned dynamically via eval()
eval(cleanContent);

// 各カードの effects → effectsV2 変換を実行し、ファイルに反映
let modified = content;
let insertions = 0;

// 既に effectsV2 がある場合はスキップ
if (content.includes('"effectsV2"')) {
  console.log("Skipped: file already contains effectsV2.");
  process.exit(0);
}

for (const card of cards) {
  if (!card.effects || card.effects.length === 0) continue;

  const v2Effects = card.effects.map(convertEffect);
  const v2Json = JSON.stringify(v2Effects, null, 2);
  // ファイルのインデント（6スペース）に合わせ
  const indented = v2Json
    .split("\n")
    .map((line, i) => (i === 0 ? line : "      " + line))
    .join("\n");

  // "effects": [...] の直後に "effectsV2": [...] を挿入
  // カードの cardNo でユニークに特定

  // このカードの effects ブロックの終わりを見つける
  // パターン: "effects": [<内容>] の後に effectsV2 を追加
  // 正規表現では難しいので、cardNo の後の最初の "effects" を見つけて
  // 対応する ] の後に挿入

  const cardNoPos = modified.indexOf('"cardNo": "' + card.cardNo + '"');
  if (cardNoPos === -1) continue;

  // このカードの effects フィールドの位置を見つける
  const searchFrom = cardNoPos;
  const effectsPos = modified.indexOf('"effects": [', searchFrom);
  if (effectsPos === -1) continue;

  // 対応する ] を見つける（ブラケットのネストを追跡）
  let depth = 0;
  let endPos = -1;
  for (let i = effectsPos + '"effects": '.length; i < modified.length; i++) {
    if (modified[i] === "[") depth++;
    else if (modified[i] === "]") {
      depth--;
      if (depth === 0) {
        endPos = i;
        break;
      }
    }
  }

  if (endPos === -1) continue;

  // ] の後に改行と effectsV2 を挿入
  const insertPoint = endPos + 1;
  const insertion = ',\n    "effectsV2": ' + indented;
  modified =
    modified.slice(0, insertPoint) + insertion + modified.slice(insertPoint);
  insertions++;
}

fs.writeFileSync(inputFile, modified, "utf-8");
console.log("Done. Inserted effectsV2 for", insertions, "cards.");
