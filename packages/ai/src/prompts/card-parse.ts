export const CARD_PARSE_SYSTEM = `あなたはバトルスピリッツのカード本文を、orica-simulator の DSL である \`Effect[]\` (JSON) に変換するパーサです。

# 出力ルール
- 出力は必ず JSON オブジェクトで、形式は \`{ "effects": Effect[] }\` 固定。
- 余分なフィールド・コメント・前置きは出力しない。
- 不明な点は \`{ "effects": [], "needsHumanReview": true, "reason": "..." }\` で返す。
- 各 \`Effect\` は \`timing\` と \`steps\` を必ず含む。
- \`timing.kind\` は次のいずれか: \`"continuous"\`, \`"card_event"\`, \`"phase"\`, \`"on_attack"\`, \`"on_block"\`, \`"on_summon"\`, \`"main"\`, \`"flash"\`。
- \`steps[].action.kind\` は実在の Action 種別 (例: \`"destroy"\`, \`"draw"\`, \`"bp_modify"\`, \`"summon"\`, \`"core_move"\`, \`"recover"\`, \`"exhaust"\` など) のみ。
- 確信度が低いステップは \`stub: "<原文の該当行>"\` を付ける。

# 重要な原則
- カード本文に明示されない数量・タイミング・対象を勝手に補わない。
- 「○○のとき」「○○したとき」は \`card_event\` または専用 timing で表現する。
- 永続的能力 (テキストにタイミング表記がない、または「常時」明示) は \`timing: { "kind": "continuous" }\` を使う。
- 値の明示がない場合 (例: 「コスト変更」だが値不明) は \`needsHumanReview\` を立てる。`;

export interface CardParseFewShot {
  cardNo: string;
  cardName: string;
  textLines: string[];
  effectsJson: string;
}

export function buildCardParseUserMessage(input: {
  cardName: string;
  cardNo: string;
  textLines: string[];
  fewShots: CardParseFewShot[];
  relevantDslHints?: string;
}): string {
  const fewShotBlocks = input.fewShots
    .map(
      (s) =>
        `## 例: ${s.cardNo} ${s.cardName}\n` +
        `テキスト行:\n${s.textLines.map((t) => `- ${t}`).join("\n")}\n` +
        `期待 JSON:\n\`\`\`json\n${s.effectsJson}\n\`\`\``
    )
    .join("\n\n");

  const hints = input.relevantDslHints
    ? `\n# 関連する DSL 仕様抜粋\n${input.relevantDslHints}\n`
    : "";

  return `${hints}# Few-shot 例\n${fewShotBlocks}\n\n# 変換対象カード\n${input.cardNo} ${input.cardName}\nテキスト行:\n${input.textLines.map((t) => `- ${t}`).join("\n")}\n\n上記カードの effects を JSON で出力してください。`;
}
