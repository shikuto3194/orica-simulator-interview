import type { CardDefinition } from "@orica/rules-core";

export { ALL_CARDS } from "./generated-index.js";

export const SAMPLE_CARDS: CardDefinition[] = [
  {
    cardNo: "DEMO-SPIRIT-001",
    name: "デモスピリット・アッシュ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    displayCostText: "3",
    reductionSymbols: ["red", "red"],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 2000 },
      { level: 2, requiredCores: 3, bp: 4000 },
    ],
    symbolColors: ["red"],
    textLines: [
      "Lv1-Lv2【常時】このカードはルールエンジン検証用のサンプルです。",
    ],
    keywordTags: ["sample"],
    sourceUrls: ["manual/ai-reference/00_meta/source-map.md"],
    sourceConfidence: "C",
  },
  {
    cardNo: "DEMO-MAGIC-001",
    name: "デモマジック・フレア",
    printedCategory: "magic",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red", "red"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【メイン】相手のスピリット1体を対象にするサンプル解決。",
      "【フラッシュ】BP比較の前に使えるサンプル解決。",
    ],
    keywordTags: ["sample", "main", "flash"],
    sourceUrls: [
      "manual/ai-reference/10_rules/03b_resolution-and-interrupts.md",
    ],
    sourceConfidence: "C",
  },
  {
    cardNo: "DEMO-BRAVE-001",
    name: "デモブレイヴ・ギア",
    printedCategory: "brave",
    colors: ["white"],
    cost: 4,
    reductionSymbols: ["white", "white"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["white"],
    textLines: [
      "【合体条件】コスト4以上。",
      "【常時】合体/交換/分離の検証用サンプル。",
    ],
    keywordTags: ["sample", "brave"],
    sourceUrls: [
      "manual/ai-reference/10_rules/05_brave-and-attack-special-cases.md",
    ],
    sourceConfidence: "C",
  },
  {
    cardNo: "DEMO-NEXUS-FORBIDDEN-001",
    name: "デモネクサス・ゼロゲート",
    printedCategory: "nexus",
    colors: ["blue"],
    cost: 4,
    reductionSymbols: ["blue", "blue"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【配置時】通常の初期コア配置を行わない特殊ネクサスのサンプルです。",
    ],
    keywordTags: ["sample", "enter_field_core_placement_forbidden"],
    sourceUrls: ["manual/ai-reference/10_rules/03a_cost-payment.md"],
    sourceConfidence: "C",
  },
  {
    cardNo: "DEMO-NEXUS-CUSTOM-PLACEMENT-001",
    name: "デモネクサス・ワンコア",
    printedCategory: "nexus",
    colors: ["yellow"],
    cost: 3,
    reductionSymbols: ["yellow"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【配置時】このカードは keywordTag placement policy でコア1個だけ置くサンプルです。",
    ],
    keywordTags: [
      "sample",
      "enter_field_core_placement_rule_required_minimum",
      "enter_field_core_placement_min_1",
      "enter_field_core_placement_max_1",
    ],
    sourceUrls: ["manual/ai-reference/30_plan/02_detailed-todo.md"],
    sourceConfidence: "C",
  },
  {
    cardNo: "DEMO-NEXUS-TAG-PLACEMENT-001",
    name: "デモネクサス・タグツーコア",
    printedCategory: "nexus",
    colors: ["green"],
    cost: 3,
    reductionSymbols: ["green"],
    levelDefs: [],
    symbolColors: [],
    textLines: [
      "【配置時】keywordTags だけで初期コア2個ちょうどを要求するサンプルです。",
    ],
    keywordTags: [
      "sample",
      "enter_field_core_placement_rule_required_minimum",
      "enter_field_core_placement_min_2",
      "enter_field_core_placement_max_2",
    ],
    sourceUrls: ["manual/ai-reference/30_plan/02_detailed-todo.md"],
    sourceConfidence: "C",
  },
];

export function getCardByNo(cardNo: string): CardDefinition | undefined {
  return SAMPLE_CARDS.find((card) => card.cardNo === cardNo);
}
