const fs = require("fs"),
  path = require("path"),
  ts = require("typescript"),
  vm = require("vm"),
  crypto = require("crypto");
function loadCards(root) {
  const directory = path.join(root, "packages/card-data/src/cards");
  const modules = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const cards = [];
  const moduleHashes = {};
  for (const file of modules) {
    const raw = fs.readFileSync(path.join(directory, file), "utf8");
    moduleHashes[file] = crypto.createHash("sha256").update(raw).digest("hex");
    const code = ts.transpileModule(raw, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const exports = {};
    vm.runInNewContext(
      code,
      {
        exports,
        require: (id) => {
          throw new Error("Unexpected runtime card import " + id);
        },
      },
      { filename: file }
    );
    for (const [name, values] of Object.entries(exports)) {
      if (!name.endsWith("_CARDS")) continue;
      if (
        !Array.isArray(values) ||
        values.some((card) => !card || typeof card.cardNo !== "string")
      )
        throw new Error("Invalid card export " + file + ":" + name);
      cards.push(...values);
    }
  }
  if (new Set(cards.map((c) => c.cardNo)).size !== cards.length)
    throw new Error("Duplicate cardNo");
  return { cards, modules, moduleHashes };
}
function scanCards(input) {
  const records = [],
    targets = [],
    reveals = [],
    allCards = [];
  const reasons = {
    "A1-revealed-target":
      "beforePick/on_step revealed対象がpendingDeckRevealを離れて共通対象選択へ移る。候補だけ表示され、固定枚数は即確定される。",
    "A2-hand-target-while-open":
      "公開中の境界で自分の手札を選択する。デッキ公開の文脈も確認できるべきだが、未確定の手札内容を相手へ公開してはいけない。",
    "A3-borrow-while-open":
      "beforeMoveの借用効果に進んだ後も公開済み借用元がlive revealedに残る。通常DeckRevealModal後の継続promptで公開文脈の確認が必要。",
    "N1-nontarget-boundary":
      "公開中の処理は誘発対象への免疫または公開枚数によるcore_move。revealedカードの対象選択UIではない。境界継続の秘匿検証対象。",
    "N2-private-peek":
      "revealTo:selfの既存DeckRevealModal経路。同じ汎用revealed対象問題には該当しない。他視点へカード素性を公開しないことを検証する。",
    "N3-deck-picker":
      "picksをpendingDeckReveal/DeckRevealModalで扱い、明示確定を既に備える。今回の汎用revealed対象選択への逸脱には非該当。",
    "N4-no-target-pick":
      "カード対象選択を要求せず、残札の並べ替えまたは自動処理と公開履歴を扱う。今回の候補UI逸脱には非該当。",
    "N5-hand-disclosure":
      "手札の公開または確認であり、デッキ公開中のrevealed候補ではない。ZoneSelectionまたは全手札公開経路とrevealTo権限を検証する。",
    "N6-revealed-event":
      "card_eventのdispositionまたはrevealed_choiceを既存デッキ公開処理で扱う。revealed filterの汎用対象選択には非該当。",
    "N7-count-before-reveal":
      "カード公開前の枚数増加選択。公開候補UIではない。",
    "N8-applicability-only":
      "継続効果の適用ゾーン宣言のみ。対象選択UIを生成しない。",
  };
  function nestedNodes(x, out = []) {
    if (!x || typeof x !== "object") return out;
    if (Array.isArray(x)) x.forEach((v) => nestedNodes(v, out));
    else {
      out.push(x);
      Object.values(x).forEach((v) => nestedNodes(v, out));
    }
    return out;
  }
  function add(c, p, classification) {
    records.push({
      cardNo: c.cardNo,
      actionPath: p,
      classification,
      rationale: reasons[classification],
    });
  }
  function walk(x, p, c, step) {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) {
      x.forEach((v, i) => walk(v, p + "[" + i + "]", c, step));
      return;
    }
    if (x.action) step = x;
    if (x.kind === "deck_reveal") {
      const boundary = [
          ...(x.beforePickSteps ?? []),
          ...(x.beforeMoveSteps ?? []),
        ],
        nodes = nestedNodes(boundary);
      const hasBoundary = boundary.length > 0;
      const classification = hasBoundary
        ? nodes.some(
            (n) =>
              n.targetSelectionTiming === "on_step" &&
              n.action?.target?.zone === "revealed"
          )
          ? "A1-revealed-target"
          : nodes.some(
                (n) =>
                  n.targetSelectionTiming === "on_step" &&
                  n.action?.kind === "reveal_hand"
              )
            ? "A2-hand-target-while-open"
            : nodes.some((n) => n.kind === "borrow_magic_effect")
              ? "A3-borrow-while-open"
              : "N1-nontarget-boundary"
        : x.revealTo === "self"
          ? "N2-private-peek"
          : x.picks?.length
            ? "N3-deck-picker"
            : "N4-no-target-pick";
      add(c, p, classification);
      reveals.push({
        cardNo: c.cardNo,
        actionPath: p,
        revealTo: x.revealTo ?? "both",
        picks: x.picks?.length ?? 0,
        beforePick: !!x.beforePickSteps?.length,
        beforeMove: !!x.beforeMoveSteps?.length,
        remainder: x.remainder,
      });
    }
    if (x.kind === "reveal_hand")
      add(c, p, x.open ? "A2-hand-target-while-open" : "N5-hand-disclosure");
    if (
      x.kind === "card_event" &&
      (Array.isArray(x.event) ? x.event : [x.event]).includes("revealed")
    )
      add(c, p, "N6-revealed-event");
    if (x.kind === "grant_optional_deck_reveal_count_boost")
      add(c, p, "N7-count-before-reveal");
    const hasRevealedZone = (
      Array.isArray(x.zone) ? x.zone : [x.zone]
    ).includes("revealed");
    if (p.endsWith(".applicability") && hasRevealedZone)
      add(c, p, "N8-applicability-only");
    if (p.endsWith(".action.target") && hasRevealedZone)
      targets.push({
        cardNo: c.cardNo,
        actionPath: p,
        actionKind: step?.action?.kind,
        targetSelectionTiming: step?.targetSelectionTiming,
        target: x,
        classification: "A1-revealed-target",
        rationale: reasons["A1-revealed-target"],
      });
    Object.entries(x).forEach(([k, v]) => walk(v, p + "." + k, c, step));
  }
  for (const card of input.cards) {
    const before = records.length;
    walk(card, "card", card);
    const matches = records.slice(before);
    allCards.push({
      cardNo: card.cardNo,
      name: card.name,
      classification: matches.length ? "related" : "non-related",
      rationale: matches.length
        ? "効果・裏面・アクセル・導技を含むカード定義の再帰走査で関連経路を検出。"
        : "カード定義全体の再帰走査でdeck_reveal/reveal_hand/revealed card_event/revealed applicability/reveal count boost/revealed targetを検出しなかった。",
      actionPaths: matches.map((row) => row.actionPath),
      classifications: [...new Set(matches.map((row) => row.classification))],
    });
  }
  const related = new Set(records.map((r) => r.cardNo));
  return {
    schemaVersion: 1,
    baseline: "8243f362e",
    scope:
      "All exported cards from every src/cards module; recursively includes backFace, accelData, divineSkills, boundary steps, choices and counts.",
    counts: {
      cardModules: input.modules.length,
      totalCards: input.cards.length,
      relevantCards: related.size,
      nonRelevantCards: input.cards.length - related.size,
      records: records.length,
      deckRevealActions: reveals.length,
      deckRevealCards: new Set(reveals.map((r) => r.cardNo)).size,
      publicRevealActions: reveals.filter((r) => r.revealTo === "both").length,
      privateRevealActions: reveals.filter((r) => r.revealTo !== "both").length,
      revealBoundaries: reveals.filter((r) => r.beforePick || r.beforeMove)
        .length,
      explicitRevealedTargetSelectors: targets.length,
      classificationCounts: records.reduce(
        (out, r) => (
          (out[r.classification] = (out[r.classification] ?? 0) + 1),
          out
        ),
        {}
      ),
    },
    modules: input.modules,
    moduleHashes: input.moduleHashes,
    records,
    explicitRevealedTargetSelectors: targets,
    deckRevealActions: reveals,
    cards: allCards,
  };
}
module.exports = { loadCards, scanCards };
if (require.main === module)
  console.log(JSON.stringify(scanCards(loadCards(process.cwd())), null, 2));
