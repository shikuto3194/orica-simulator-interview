// P3-170 効果由来の使用会計の再分散防止 (check:ssot の構造検査)。
// ソース文字列だけを読む。GameState の実体は読まない。
//
// 検出する違反:
//   1. direct-write   : 許可外モジュールが GameState.effectAccounting を直接書込む、または
//                       台帳オブジェクト (buckets/operations/grants) を組み立てる・配列を破壊的に変える
//                       (別モジュールからの直接加算)。
//   2. own-key        : 識別キー生成関数 (makeBucketKey / makeConstraintId / abilityRefKey) を
//                       effect-usage/ の外で使う (別キー生成)。
//   3. legacy-field   : 移行済みの旧会計フィールド名を実行時コードが参照する。
//   4. ce-source-effect: 継続効果(CE)の使用枠(ラベルが経路名)の列挙・記録が、登録元の効果
//                       (`sourceEffect`) を渡していない。【魂状態】を含む効果は個体の寿命キーが
//                       変わるため、片方だけだと記録しても枠が効かない(〔ターンに1回〕が無制限になる)。
//
// 検出は「素直な書き方」に限らない。プロパティ参照だけでなく、分割代入・要素アクセス・
// 計算キー・同一ファイル内の const 文字列の連結・`Reflect.get(s, "…")` のような文字列引数、
// 台帳の配列の破壊的操作、`import * as ns` 経由のキー生成関数も同じ違反として扱う。
// (変数を経由する動的な名前の組み立てなど、静的に決まらないものは対象外。レビューで補う。)
//
// 許可は正源モジュール・境界migration・fixture builder に限り、理由を併記する。
import ts from "typescript";

/** effectAccounting を直接書込んでよいファイル (理由つき)。 */
export const EFFECT_ACCOUNTING_WRITE_ALLOW = [
  { re: /packages\/rules-core\/src\/effect-usage\//, why: "台帳の正源" },
  {
    re: /packages\/rules-core\/src\/effect\/effect-usage-accounting\.ts$/,
    why: "GameStateへ台帳を反映する唯一のアダプタ",
  },
  {
    re: /packages\/rules-core\/src\/factories\.ts$/,
    why: "初期状態の生成",
  },
  {
    re: /packages\/rules-core\/src\/state-sanitize\.ts$/,
    why: "保存復元の既定値と公開投影",
  },
  {
    re: /packages\/rules-core\/src\/snapshot\.ts$/,
    why: "版付きmigrationの境界",
  },
];

/** 識別キー生成関数。effect-usage/ の外では使わない。 */
export const IDENTITY_KEY_FUNCTIONS = new Set([
  "makeBucketKey",
  "makeConstraintId",
  "abilityRefKey",
]);

/** 移行済みの旧フィールド。移行の完了ごとに追加する。runtime 参照を禁止する。 */
export const LEGACY_ACCOUNTING_FIELDS = new Set([
  // I13/I14/I15 (数量・宣言事実・N回目観測)
  "effectOccurrenceRecords",
  "declarationCountThisTurn",
  "effectLifeReductionThisTurn",
  "lifeReductionCappedThisTurn",
  "filteredLifeReductionCappedThisTurn",
  "bpThresholdCappedLifeReductionThisTurn",
  "symbolAdditionRestrictedCountThisTurn",
  "effectUsageRecords",
  "usedDivineSkillKeysThisTurn",
  "usedTrashAdventKeysThisTurn",
  "usedAlternateCostAdventKeysThisTurn",
  "usedAdventDeclareKeysThisTurn",
  "countGainModifierConsumedThisTurn",
  "usedTaplessBattleDeclareInstanceIdsThisTurn",
  "declareGimmickGateUsedThisTurn",
  "lifeDamageInterceptionUseCostGateUsedThisTurn",
  "mirageSetCountExemptionsUsed",
  "pendingAdditionalAttackGrants",
  "connectBattleGrant",
  // 宣言時消費済みの二重消費防止フラグ (receipt 参照に置換済み)
  "usageLimitConsumedOnPrivateDeclaration",
  "usageLimitConsumed",
  "mirageSetCountExemptionConsumed",
  "consumedUsageGroups",
  "mirageSetCountExemptionUsedPlayerIds",
  // 取消の差分を旧形式で運んでいたフィールド (receipt の operationId に置換済み)
  "refundableUsageEntries",
  "declarationUsageDeltas",
  "declarationOccurrenceDeltas",
]);

/** 旧フィールド名を参照してよいファイル: 旧形式の検出・移行の境界のみ。 */
export const LEGACY_FIELD_ALLOW = [
  {
    re: /packages\/rules-core\/src\/effect-usage\/migration\.ts$/,
    why: "旧形式を新形式へ変換する境界",
  },
  {
    re: /packages\/rules-core\/src\/effect-usage\/legacy-guard\.ts$/,
    why: "旧形式の状態を読込時に検出する境界 (旧名は文字列として照合するだけ)",
  },
  {
    re: /packages\/rules-core\/src\/ai-observation-encoder\.ts$/,
    why: "保存済みの旧観測が書いた pending kind 名を、改名後の語彙へ写す境界 (旧名は文字列のデータ。GameState の旧フィールドは読まない)",
  },
];

/** 台帳の中身 (配列・Map) を破壊的に変えるメソッド。effectAccounting 配下の受け手には使えない。 */
const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);
const LEDGER_PARTS = new Set(["buckets", "operations", "grants"]);

/** ラベルが経路名で、ラベルから登録元の効果を逆引きできない CE の使用枠。列挙と記録は sourceEffect が必須。 */
export const CE_ROUTE_USAGE_LABELS = new Set([
  "redirect_effect_target",
  "expand_effect_target_count",
  "grant_effect_source_prevention_immunity",
]);
const USAGE_CALL_NAMES = new Set([
  "canUseEffectByUsageLimit",
  "recordEffectUsageIfLimited",
  "recordEffectUsageWithReceipt",
]);

const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

function parse(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

function isAllowed(rel, table) {
  return table.some((entry) => entry.re.test(rel));
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

/** 静的に決まる文字列 (リテラル・const参照・連結・テンプレート)。決まらなければ undefined。 */
function constString(node, consts) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isIdentifier(node)) return consts.get(node.text);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return constString(node.expression, consts);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constString(node.left, consts);
    const right = constString(node.right, consts);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const value = constString(span.expression, consts);
      if (value === undefined) return undefined;
      out += value + span.literal.text;
    }
    return out;
  }
  return undefined;
}

/** 同一ファイル内の `const NAME = "literal"` を集める。 */
function collectConstStrings(file) {
  const consts = new Map();
  const walk = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      const value = constString(node.initializer, consts);
      if (value !== undefined) consts.set(node.name.text, value);
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return consts;
}

/** プロパティ名 (識別子・文字列・静的に決まる計算キー)。 */
function nameText(name, consts) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name))
    return constString(name.expression, consts);
  return undefined;
}

/** オブジェクトの要素 (代入・省略形・型宣言・分割代入) が指すキー名。 */
function memberKey(node, consts) {
  if (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node)
  )
    return nameText(node.name, consts);
  if (ts.isBindingElement(node))
    return nameText(node.propertyName ?? node.name, consts);
  return undefined;
}

/** `x.name` / `x["name"]` のメンバ名。 */
function accessedName(node, consts) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node))
    return constString(node.argumentExpression, consts);
  return undefined;
}

/** 式の連鎖 (a.b["c"].d) のメンバ名を根から順に返す。 */
function accessChain(node, consts) {
  const names = [];
  let current = node;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    if (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)
    ) {
      const name = accessedName(current, consts);
      if (name !== undefined) names.unshift(name);
    }
    current = current.expression;
  }
  return names;
}

/**
 * @param {Map<string,string>} sources  リポジトリ相対パス(/区切り) → ソース文字列。
 *   対象は rules-core / ai / replay-codec の src と apps の実行時コード。テストは含めない。
 * @returns {{file:string, line:number, kind:string, detail:string}[]}
 */
export function findEffectUsageSsotIssues(sources) {
  const issues = [];
  for (const [rel, text] of sources) {
    if (!/\.(ts|tsx|mjs|js)$/.test(rel)) continue;
    const file = parse(rel, text);
    const consts = collectConstStrings(file);
    const writeAllowed = isAllowed(rel, EFFECT_ACCOUNTING_WRITE_ALLOW);
    const keyAllowed = /packages\/rules-core\/src\/effect-usage\//.test(rel);
    const legacyAllowed = isAllowed(rel, LEGACY_FIELD_ALLOW);
    const seen = new Set();
    const report = (node, kind, detail) => {
      const line = lineOf(file, node);
      const id = `${line}:${kind}:${detail}`;
      if (seen.has(id)) return;
      seen.add(id);
      issues.push({ file: rel, line, kind, detail });
    };
    const reportWrite = (node, detail) => report(node, "direct-write", detail);

    const visit = (node) => {
      // 1) effectAccounting / 台帳への直接書込
      if (!writeAllowed) {
        // フィールドの分類表 (`effectAccounting: "viewer-private"` のように値が文字列) は
        // 状態の書込みではないので対象外にする。
        const isClassificationEntry =
          ts.isPropertyAssignment(node) &&
          constString(node.initializer, consts) !== undefined;
        if (
          !isClassificationEntry &&
          (ts.isPropertyAssignment(node) ||
            ts.isShorthandPropertyAssignment(node)) &&
          memberKey(node, consts) === "effectAccounting"
        )
          reportWrite(
            node,
            "GameState.effectAccounting を許可外モジュールが書込んでいます。effect/effect-usage-accounting.ts の状態アダプタ経由にしてください。"
          );
        if (
          ts.isBinaryExpression(node) &&
          ASSIGNMENT_OPERATORS.has(node.operatorToken.kind) &&
          (ts.isPropertyAccessExpression(node.left) ||
            ts.isElementAccessExpression(node.left)) &&
          accessChain(node.left, consts).includes("effectAccounting")
        )
          reportWrite(
            node,
            "effectAccounting またはその配下への代入です。状態アダプタ経由にしてください。"
          );
        if (
          ts.isDeleteExpression(node) &&
          accessChain(node.expression, consts).includes("effectAccounting")
        )
          reportWrite(node, "effectAccounting 配下の delete です。");
        // 台帳の配列・Map の破壊的操作 (state.effectAccounting.buckets.push(...))
        if (
          ts.isCallExpression(node) &&
          (ts.isPropertyAccessExpression(node.expression) ||
            ts.isElementAccessExpression(node.expression))
        ) {
          const method = accessedName(node.expression, consts);
          const receiver = accessChain(node.expression.expression, consts);
          if (
            method !== undefined &&
            MUTATING_METHODS.has(method) &&
            receiver.includes("effectAccounting")
          )
            reportWrite(
              node,
              `effectAccounting 配下に ${method}() を呼んでいます。台帳の変更は ledger の API だけが行います。`
            );
        }
        // 台帳オブジェクトの組み立て: buckets と operations を両方持つ、
        // または effectAccounting の spread に台帳の部品を上書きする (部分的な組み立て)。
        if (ts.isObjectLiteralExpression(node)) {
          const names = new Set(
            node.properties
              .map((p) => memberKey(p, consts))
              .filter((n) => n !== undefined)
          );
          const parts = [...names].filter((n) => LEDGER_PARTS.has(n));
          // 読み取り専用の投影 (署名用に buckets と grants だけを写す等) は台帳の組み立てではない。
          // 台帳そのもの (buckets と operations を両方持つ) か、effectAccounting を spread して
          // 部品を上書きする形だけを違反にする。
          const isLedgerShape = names.has("buckets") && names.has("operations");
          const spreadsLedger = node.properties.some(
            (p) =>
              ts.isSpreadAssignment(p) &&
              accessChain(p.expression, consts).includes("effectAccounting")
          );
          if (isLedgerShape || (parts.length >= 1 && spreadsLedger))
            reportWrite(
              node,
              "台帳 (buckets/operations/grants) を許可外モジュールが組み立てています。effect-usage/ledger.ts の API を使ってください。"
            );
        }
      }
      // 2) 識別キー生成関数の利用
      if (!keyAllowed) {
        if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
          const imported = (node.propertyName ?? node.name).text;
          if (IDENTITY_KEY_FUNCTIONS.has(imported))
            report(
              node,
              "own-key",
              `${imported} は effect-usage/ の外で使えません。識別キーは台帳APIだけが生成します。`
            );
        }
        // 直接の呼び出し・名前空間経由・要素アクセス (ns.makeBucketKey / ns["makeBucketKey"])
        let called;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
          called = node.expression.text;
        else if (
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)
        )
          called = accessedName(node, consts);
        if (called !== undefined && IDENTITY_KEY_FUNCTIONS.has(called))
          report(
            node,
            "own-key",
            `${called} の利用は effect-usage/ の外では禁止です。`
          );
      }
      // 3) 旧会計フィールドの参照
      if (!legacyAllowed) {
        const names = [];
        const key = memberKey(node, consts);
        if (key !== undefined) names.push(key);
        const accessed = accessedName(node, consts);
        if (accessed !== undefined) names.push(accessed);
        // 文字列そのもの ("effectUsageRecords" / 連結で作った名前)。Reflect.get や in 演算子の引数も含む。
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateExpression(node) ||
          (ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.PlusToken)
        ) {
          const value = constString(node, consts);
          if (value !== undefined) names.push(value);
        }
        for (const name of names)
          if (LEGACY_ACCOUNTING_FIELDS.has(name))
            report(
              node,
              "legacy-field",
              `旧会計フィールド ${name} の参照です。旧形式は migration と旧形式検出の境界に限ります。`
            );
      }
      // 4) CE 経路ラベルの使用枠は登録元の効果(sourceEffect)を必ず渡す
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        USAGE_CALL_NAMES.has(node.expression.text) &&
        node.arguments[0] !== undefined &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const props = node.arguments[0].properties;
        const labelProp = props.find(
          (prop) => memberKey(prop, consts) === "effectLabel"
        );
        const label =
          labelProp && ts.isPropertyAssignment(labelProp)
            ? constString(labelProp.initializer, consts)
            : undefined;
        if (label !== undefined && CE_ROUTE_USAGE_LABELS.has(label)) {
          const hasSourceEffect = props.some(
            (prop) => memberKey(prop, consts) === "sourceEffect"
          );
          if (!hasSourceEffect)
            report(
              node,
              "ce-source-effect",
              `${node.expression.text} の effectLabel="${label}" に sourceEffect がありません。列挙と同じ sourceEffectOfContinuousEffect(ce, getCardDefinitionById) を渡してください。`
            );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return issues;
}
