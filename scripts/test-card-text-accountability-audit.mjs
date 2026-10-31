#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  rmSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTextAccountabilityLedger,
  createLegacyBaseline,
  sourceHash,
  validateInitialLegacyBaseline,
  hasExactPrintedOracleCarrier,
  hasExactBlueMagicDomainCarrier,
  hasExactNoContractEntryCarrier,
  hasExactManifestCarrier,
} from "./card-text-accountability-core.mjs";
import { collectCoverageFindings } from "./cards-coverage.mjs";

const testFiles = new Map([
  [
    "packages/rules-core/test/bsth02-7-x03-manifest.test.ts",
    'it("BSTH02.7-X03本文監査: 窓後に対象の1コアとソウルコアをトラッシュへ払い、維持コア配置まで完走する", () => {});',
  ],
  [
    "packages/rules-core/test/bsth10-no-contract-entry.test.ts",
    'it("BSTH10 の7枚は契約未採用なら通常召喚をスタック解決して場に出せる", () => {}); it("BSTH10-X05 は契約未採用なら現界を宣言し、窓後にソウルコア支払いと場入りを完了する", () => {});',
  ],
  [
    "packages/rules-core/test/unconditional-tribes-carrier.test.ts",
    'it("系統本文監査16面: 各印字系統でトラッシュ回収と手札破棄を完走し、異系統は残る", () => {});',
  ],
  [
    "packages/rules-core/test/advent-declaration.test.ts",
    'it("メインステップでソウルコアと有効な煌臨先があれば declare_advent が legal になる", () => {});',
  ],
  [
    "packages/rules-core/test/bssl01-cards.test.ts",
    'it("盤面: 煌臨適用後、消費したソウルコアはトラッシュではなく煌臨後のこのスピリット自身に置かれる", () => {});',
  ],
  [
    "packages/rules-core/test/tensho-summon-gate.test.ts",
    'it("コスト支払い→スタック窓→転召（場入り前）→維持コア配置 の順で解決する", () => {});',
  ],
  [
    "packages/rules-core/test/grandstone.test.ts",
    'it("陰陽玉本文監査: 名前/系統と召喚/アタックの解封、閾値/カウント境界、転醒合体の最終盤面", () => {});',
  ],
  [
    "packages/rules-core/test/printed-grandstone-carrier.test.ts",
    'it("創界石4面本文監査: OR条件・辞退・閾値/カウント・残置/合体/配置・解封除外の最終盤面", () => {});',
  ],
  [
    "packages/rules-core/test/bsth002-c01-mirage-set-count-exemption.test.ts",
    'it("同名ターン1回はプレイヤー+cardNoで共有し、最初の化け化けは通常セット行動数を使わない", () => {});',
  ],
  [
    "packages/rules-core/test/bsaz02-c01-alguile.test.ts",
    'it("自分の場に「ＣＦ」アルティメットが0体なら召喚可", () => {});',
  ],
  [
    "packages/rules-core/test/bslh01-cards.test.ts",
    'it("BSLH01-T07〜T17 arts-soul-state-attribute-placement-gate: 原文の全 OR 属性プロファイルを満たすと自動配置し、必須値を失うと配置しない", () => {});',
  ],
  [
    "packages/rules-core/test/brave-combine-summon.test.ts",
    'it("合体条件 (cardNames 完全一致) を満たすホストだけが合体候補になる", () => {});',
  ],
  [
    "packages/rules-core/test/bsaz01-cards.test.ts",
    'it("BSAZ01-C18 は『界塚伊奈帆』合体中のＣＦスピリットへ追加合体できる", () => {});',
  ],
  [
    "packages/rules-core/test/engine-aldnoah-drive-under-card-keyword.test.ts",
    [
      'it("brave_combine: C10 自身をブレイヴとして場に出しても cannot_combine で合体先候補に出せない", () => {});',
      'it("BSAZ02-C10 は印字どおり20枚を超えてメインデッキに入れられない", () => {});',
    ].join(" "),
  ],
  [
    "packages/rules-core/test/bsaz02-x04-aselam.test.ts",
    'it("kind:guided + 本文どおりの召喚/煌臨トリガーとoracleConditions 3件が宣言される", () => {});',
  ],
  [
    "packages/rules-core/test/bsge01-cards.test.ts",
    [
      'it("誘発配線: 契約合体で場入りしたブレイヴの『召喚/契約合体時』は契約合体時として pendingTriggeredEffects へ積まれる", () => {});',
      'it("魂状態の契約カード (CX01) は契約合体の対象になる", () => {});',
      'it("適用: コスト源のコア1個がボイドへ、魂状態を離れ、reserve_only の任意コア配置が開く（召喚扱いではない）", () => {});',
    ].join(" "),
  ],
  [
    "packages/rules-core/test/bses01-t01-forced-token-combine.test.ts",
    'it("[board] 系統「８６」ブレイヴの召喚コスト支払い前にM1A4トークンが場に出て、窓クローズ後は合体選択が提示されず強制合体する", () => {});',
  ],
  [
    "packages/rules-core/test/bsrk01-advent.test.ts",
    [
      'it("BSRK01-CX01 の魂状態に BSRK01-C04 を契約煌臨すると任意コア配置 pending が生成される", () => {});',
      'it("適用後: ソウルコアは実消費されず(元々null)、overlay成立、usedAlternateCostAdventKeysThisTurnに記録され、同ターン中は同名の別インスタンスでも代替コスト経路が再度出ない", () => {});',
    ].join(" "),
  ],
  [
    "packages/rules-core/test/phase-f-grandwalker.test.ts",
    [
      'it("F-real: BSLH01-X01 の召喚/煌臨導託は辞退後なら同ステップで再度キューできる", () => {});',
      'it("配置時導託のマッチ数は additional_cost CE の実効コストも見る", () => {});',
    ].join(" "),
  ],
  [
    "packages/rules-core/test/bssa01-bssg02-cards.test.ts",
    'it("grandwalkerData(grandwalker) + 神技2/神技4 effect 配線 + 多色treat_as を実装", () => {});',
  ],
  [
    "packages/rules-core/test/bssa01-cards.test.ts",
    'it("BSSA01-C06 effects: 軽減シンボル紫/白扱い + 使用後フィールド残置 + スタック prevent_battle", () => {});',
  ],
  [
    "packages/rules-core/test/bssg01-cards.test.ts",
    'it("召喚時 実行: ボイドのコア1個が自身へ移動", () => {});',
  ],
  [
    "packages/rules-core/test/host-dual-advent.test.ts",
    'it("代替コスト経路 (擬制消費) は emit され、ソウルコアを消費せず契約煌臨できる", () => {});',
  ],
  [
    "packages/rules-core/test/multi-host-advent.test.ts",
    'it("対象2体を1つの煌臨元スタックへ統合し、選んだ「上」が状態を引き継ぎ、コアは合算される", () => {});',
  ],
  [
    "packages/rules-core/test/quartz-system.test.ts",
    'it("BSLH01-CX01: 魂状態でない field ENIGMA は SBA で存在できず trash へ送られる", () => {});',
  ],
  [
    "packages/rules-core/test/bsth003-cards.test.ts",
    'it("[board] 受けず選択 (choiceIndex 1): 手札のミミちゃんが対象の導魔スピリットへ直接合体し、相手の破壊効果を免疫で防ぎつつ離脱耐性CEを登録する", () => {});',
  ],
  [
    "packages/rules-core/test/bsth02-x04-multi-brave-combine.test.ts",
    'it("既に導魔ブレイヴ3体が合体済み (上限到達) のとき、4体目とは合体できない", () => {});',
  ],
  [
    "packages/rules-core/test/bsth02-7-x03-manifest.test.ts",
    'it("manifestData が対象条件どおりに配線されている", () => {});',
  ],
  [
    "packages/rules-core/test/bsge01-mirage-set-drain.test.ts",
    'it("mirageData: cost 2 / reduction 赤", () => {});',
  ],
  [
    "packages/rules-core/test/bsdb01-cards.test.ts",
    'it("[board] トラッシュからコスト1を支払ってセットし、ミラージュへ移す", () => {});',
  ],
  [
    "packages/rules-core/test/accel-change-system.test.ts",
    'it("AccelData is set on CardDefinition", () => {}); it("ChangeData is set on CardDefinition", () => {});',
  ],
  [
    "packages/rules-core/test/bsaz02-tr01-heras.test.ts",
    'it("BSAZ02-TR01(B) aldnoah-drive-under-card-slot-capacity: 転醒後もC10を1枚まで配置し、ドライブ下の継続効果を盤面へ登録する", () => {});',
  ],
  [
    "packages/rules-core/test/bsft01-cards.test.ts",
    'it("BSFT01-TR02(B) star-garment-under-placement-exclusion: [board] 親A面を選んでもB面タグにより星霊衣の配置候補にならない", () => {});',
  ],
  [
    "packages/rules-core/test/attacker-filtered-life-prevention.test.ts",
    'it("level-heading-all-defined-levels: TR12(B)/TR13(B) は全Lvでライフ減少を防止する", () => {});',
  ],
  [
    "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
    [
      'it("各 B 面定義は boilerplate 由来の count_increase rebirth 効果を持たない", () => {});',
      'it("BSTH09.2-転醒R03(B): 親 A 面の rebirth で B 面へ裏返り、定型 count + B面転醒時効果を最終盤面まで解決する", () => {});',
    ].join(" "),
  ],
  [
    "packages/rules-core/test/test-card.test.ts",
    'it("TEST-CARRIER-OVERRIDE fixture-carrier-behavior", () => {});',
  ],
]);

const discoveredTestTitles = new Map([
  [
    "packages/rules-core/test/bsth10-no-contract-entry.test.ts",
    new Set([
      "BSTH10 の7枚は契約未採用なら通常召喚をスタック解決して場に出せる",
      "BSTH10-X05 は契約未採用なら現界を宣言し、窓後にソウルコア支払いと場入りを完了する",
    ]),
  ],
  [
    "packages/rules-core/test/unconditional-tribes-carrier.test.ts",
    new Set([
      "系統本文監査16面: 各印字系統でトラッシュ回収と手札破棄を完走し、異系統は残る",
    ]),
  ],
  [
    "packages/rules-core/test/advent-declaration.test.ts",
    new Set([
      "メインステップでソウルコアと有効な煌臨先があれば declare_advent が legal になる",
    ]),
  ],
  [
    "packages/rules-core/test/bssl01-cards.test.ts",
    new Set([
      "盤面: 煌臨適用後、消費したソウルコアはトラッシュではなく煌臨後のこのスピリット自身に置かれる",
    ]),
  ],
  [
    "packages/rules-core/test/tensho-summon-gate.test.ts",
    new Set([
      "コスト支払い→スタック窓→転召（場入り前）→維持コア配置 の順で解決する",
    ]),
  ],
  [
    "packages/rules-core/test/grandstone.test.ts",
    new Set([
      "陰陽玉本文監査: 名前/系統と召喚/アタックの解封、閾値/カウント境界、転醒合体の最終盤面",
    ]),
  ],
  [
    "packages/rules-core/test/printed-grandstone-carrier.test.ts",
    new Set([
      "創界石4面本文監査: OR条件・辞退・閾値/カウント・残置/合体/配置・解封除外の最終盤面",
    ]),
  ],
  [
    "packages/rules-core/test/bsth002-c01-mirage-set-count-exemption.test.ts",
    new Set([
      "同名ターン1回はプレイヤー+cardNoで共有し、最初の化け化けは通常セット行動数を使わない",
    ]),
  ],
  [
    "packages/rules-core/test/bsaz02-c01-alguile.test.ts",
    new Set(["自分の場に「ＣＦ」アルティメットが0体なら召喚可"]),
  ],
  [
    "packages/rules-core/test/bslh01-cards.test.ts",
    new Set([
      "BSLH01-T07〜T17 arts-soul-state-attribute-placement-gate: 原文の全 OR 属性プロファイルを満たすと自動配置し、必須値を失うと配置しない",
    ]),
  ],
  [
    "packages/rules-core/test/brave-combine-summon.test.ts",
    new Set([
      "合体条件 (cardNames 完全一致) を満たすホストだけが合体候補になる",
    ]),
  ],
  [
    "packages/rules-core/test/bsaz01-cards.test.ts",
    new Set([
      "BSAZ01-C18 は『界塚伊奈帆』合体中のＣＦスピリットへ追加合体できる",
    ]),
  ],
  [
    "packages/rules-core/test/engine-aldnoah-drive-under-card-keyword.test.ts",
    new Set([
      "brave_combine: C10 自身をブレイヴとして場に出しても cannot_combine で合体先候補に出せない",
      "BSAZ02-C10 は印字どおり20枚を超えてメインデッキに入れられない",
    ]),
  ],
  [
    "packages/rules-core/test/bsaz02-x04-aselam.test.ts",
    new Set([
      "kind:guided + 本文どおりの召喚/煌臨トリガーとoracleConditions 3件が宣言される",
    ]),
  ],
  [
    "packages/rules-core/test/bsge01-cards.test.ts",
    new Set([
      "誘発配線: 契約合体で場入りしたブレイヴの『召喚/契約合体時』は契約合体時として pendingTriggeredEffects へ積まれる",
      "魂状態の契約カード (CX01) は契約合体の対象になる",
      "適用: コスト源のコア1個がボイドへ、魂状態を離れ、reserve_only の任意コア配置が開く（召喚扱いではない）",
    ]),
  ],
  [
    "packages/rules-core/test/bses01-t01-forced-token-combine.test.ts",
    new Set([
      "[board] 系統「８６」ブレイヴの召喚コスト支払い前にM1A4トークンが場に出て、窓クローズ後は合体選択が提示されず強制合体する",
    ]),
  ],
  [
    "packages/rules-core/test/bsrk01-advent.test.ts",
    new Set([
      "BSRK01-CX01 の魂状態に BSRK01-C04 を契約煌臨すると任意コア配置 pending が生成される",
      "適用後: ソウルコアは実消費されず(元々null)、overlay成立、usedAlternateCostAdventKeysThisTurnに記録され、同ターン中は同名の別インスタンスでも代替コスト経路が再度出ない",
    ]),
  ],
  [
    "packages/rules-core/test/phase-f-grandwalker.test.ts",
    new Set([
      "F-real: BSLH01-X01 の召喚/煌臨導託は辞退後なら同ステップで再度キューできる",
      "配置時導託のマッチ数は additional_cost CE の実効コストも見る",
    ]),
  ],
  [
    "packages/rules-core/test/bssa01-bssg02-cards.test.ts",
    new Set([
      "grandwalkerData(grandwalker) + 神技2/神技4 effect 配線 + 多色treat_as を実装",
    ]),
  ],
  [
    "packages/rules-core/test/bssa01-cards.test.ts",
    new Set([
      "BSSA01-C06 effects: 軽減シンボル紫/白扱い + 使用後フィールド残置 + スタック prevent_battle",
    ]),
  ],
  [
    "packages/rules-core/test/bssg01-cards.test.ts",
    new Set(["召喚時 実行: ボイドのコア1個が自身へ移動"]),
  ],
  [
    "packages/rules-core/test/host-dual-advent.test.ts",
    new Set([
      "代替コスト経路 (擬制消費) は emit され、ソウルコアを消費せず契約煌臨できる",
    ]),
  ],
  [
    "packages/rules-core/test/multi-host-advent.test.ts",
    new Set([
      "対象2体を1つの煌臨元スタックへ統合し、選んだ「上」が状態を引き継ぎ、コアは合算される",
    ]),
  ],
  [
    "packages/rules-core/test/quartz-system.test.ts",
    new Set([
      "BSLH01-CX01: 魂状態でない field ENIGMA は SBA で存在できず trash へ送られる",
    ]),
  ],
  [
    "packages/rules-core/test/bsth003-cards.test.ts",
    new Set([
      "[board] 受けず選択 (choiceIndex 1): 手札のミミちゃんが対象の導魔スピリットへ直接合体し、相手の破壊効果を免疫で防ぎつつ離脱耐性CEを登録する",
    ]),
  ],
  [
    "packages/rules-core/test/bsth02-x04-multi-brave-combine.test.ts",
    new Set([
      "既に導魔ブレイヴ3体が合体済み (上限到達) のとき、4体目とは合体できない",
    ]),
  ],
  [
    "packages/rules-core/test/bsth02-7-x03-manifest.test.ts",
    new Set(["manifestData が対象条件どおりに配線されている"]),
  ],
  [
    "packages/rules-core/test/bsge01-mirage-set-drain.test.ts",
    new Set(["mirageData: cost 2 / reduction 赤"]),
  ],
  [
    "packages/rules-core/test/bsdb01-cards.test.ts",
    new Set([
      "[board] トラッシュからコスト1を支払ってセットし、ミラージュへ移す",
    ]),
  ],
  [
    "packages/rules-core/test/accel-change-system.test.ts",
    new Set([
      "AccelData is set on CardDefinition",
      "ChangeData is set on CardDefinition",
    ]),
  ],
  [
    "packages/rules-core/test/bsaz02-tr01-heras.test.ts",
    new Set([
      "BSAZ02-TR01(B) aldnoah-drive-under-card-slot-capacity: 転醒後もC10を1枚まで配置し、ドライブ下の継続効果を盤面へ登録する",
    ]),
  ],
  [
    "packages/rules-core/test/bsft01-cards.test.ts",
    new Set([
      "BSFT01-TR02(B) star-garment-under-placement-exclusion: [board] 親A面を選んでもB面タグにより星霊衣の配置候補にならない",
    ]),
  ],
  [
    "packages/rules-core/test/attacker-filtered-life-prevention.test.ts",
    new Set([
      "level-heading-all-defined-levels: TR12(B)/TR13(B) は全Lvでライフ減少を防止する",
    ]),
  ],
  [
    "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
    new Set([
      "各 B 面定義は boilerplate 由来の count_increase rebirth 効果を持たない",
      "BSTH09.2-転醒R03(B): 親 A 面の rebirth で B 面へ裏返り、定型 count + B面転醒時効果を最終盤面まで解決する",
    ]),
  ],
  [
    "packages/rules-core/test/test-card.test.ts",
    new Set(["TEST-CARRIER-OVERRIDE fixture-carrier-behavior"]),
  ],
]);

const cards = [
  {
    cardNo: "TEST-CARD",
    textLines: [
      "見出しのない未帰属の実行本文。",
      "Lv1『このスピリットの召喚時』",
      "自分はデッキから1枚ドローする。",
      "《召喚条件：自分のスピリット1体》",
    ],
    summonCondition: [{ kind: "field_has" }],
    effects: [{ textRef: [1, 2], steps: [] }],
  },
  {
    cardNo: "TEST-RULE",
    textLines: ["この面に裏返ったとき、フィールドに残り、カウント+1する。"],
    effects: [],
  },
  {
    cardNo: "TEST-RULE-REMAINING",
    textLines: [
      "この面に裏返ったとき、フィールドに残り、残りカウント＋1する。",
    ],
    effects: [],
  },
  {
    cardNo: "TEST-RULE-ANNOTATED",
    textLines: [
      "この転醒後スピリットに裏返ったとき、フィールドに残りカウントを+1する。（注記）",
    ],
    effects: [],
  },
  {
    cardNo: "TEST-RULE-AMBIGUOUS",
    textLines: ["この面に裏返ったとき、フィールドに残り、カウント1する。"],
    effects: [],
  },
  {
    cardNo: "TEST-EXEMPT",
    textLines: ["デッキ構築だけに関する注記。"],
    effects: [],
  },
  {
    cardNo: "TEST-CARRIER-OVERRIDE",
    textLines: ["明示した carrier contract の本文。"],
    adventData: { source: "fixture" },
    effects: [],
  },
];

// 監査 batch の共通機構は、カード番号を免除するのではなく、原文の値を復元できる
// carrier だけを受理する。各 broken 例は同じ本文でも DSL の要件を一つ崩すと
// unclaimed に戻ることを固定する。
const mechanicsCarrierCards = [
  {
    cardNo: "TEST-SPACED-CONTRACT-ADVENT",
    textLines: ["フラッシュ 【契約煌臨：「水篠 旬」『自分のターン』】"],
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    effects: [],
  },
  {
    cardNo: "TEST-SPACED-CONTRACT-ADVENT-BROKEN",
    textLines: ["フラッシュ 【契約煌臨：「水篠 旬」『自分のターン』】"],
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        targetCategory: ["spirit"],
        isContract: true,
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
    },
    effects: [],
  },
  {
    cardNo: "TEST-SPACED-CONTRACT-ADVENT-HIDDEN-C7-BROKEN",
    textLines: ["フラッシュ 【契約煌臨：「水篠 旬」『自分のターン』】"],
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "trash",
      adventVariant: "contract",
      declareCondition: [{ kind: "count_value", player: "self", min: 7 }],
    },
    effects: [],
  },
  {
    cardNo: "TEST-SUPER-CONTRACT-ADVENT",
    textLines: [
      "フラッシュ【超契約煌臨：「水篠 旬」＆契約スピリット＆C7以上『自分のターン』】",
      "〔ターンに1回:同名〕このカードを手札から魂状態/煌臨元を含む対象に重ねることで、自分の《ソウルコア》をこのスピリットに置く。",
      "",
      "このカードを【煌臨】するとき、手札/トラッシュにある系統：「プレイヤー」を持つカードを好きなだけ魂状態を含む煌臨元スピリットの下に追加できる。",
    ],
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        isContract: true,
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "this_card",
      adventVariant: "contract",
      includeAdventSourceTarget: true,
      declareUsageLimit: { kind: "per_card_name", duration: "turn" },
      declareCondition: [{ kind: "count_value", player: "self", min: 7 }],
      beforeAdventSourceAddition: {
        fromZones: ["hand", "trash"],
        filter: { tribes: ["プレイヤー"] },
        textRef: [3],
      },
    },
    effects: [],
  },
  {
    cardNo: "TEST-SUPER-CONTRACT-ADVENT-BROKEN",
    textLines: [
      "フラッシュ【超契約煌臨：「水篠 旬」＆契約スピリット＆C7以上『自分のターン』】",
      "〔ターンに1回:同名〕このカードを手札から魂状態/煌臨元を含む対象に重ねることで、自分の《ソウルコア》をこのスピリットに置く。",
      "",
      "このカードを【煌臨】するとき、手札/トラッシュにある系統：「プレイヤー」を持つカードを好きなだけ魂状態を含む煌臨元スピリットの下に追加できる。",
    ],
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        isContract: true,
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "this_card",
      adventVariant: "contract",
      includeAdventSourceTarget: true,
      declareUsageLimit: { kind: "per_card_name", duration: "turn" },
      declareCondition: [{ kind: "count_value", player: "self", min: 6 }],
      beforeAdventSourceAddition: {
        fromZones: ["hand", "trash"],
        filter: { tribes: ["プレイヤー"] },
        textRef: [3],
      },
    },
    effects: [],
  },
  {
    cardNo: "TEST-SUPER-CONTRACT-ADVENT-HIDDEN-DATA-BROKEN",
    textLines: [
      "フラッシュ【超契約煌臨：「水篠 旬」＆契約スピリット＆C7以上『自分のターン』】",
      "〔ターンに1回:同名〕このカードを手札から魂状態/煌臨元を含む対象に重ねることで、自分の《ソウルコア》をこのスピリットに置く。",
      "",
      "このカードを【煌臨】するとき、手札/トラッシュにある系統：「プレイヤー」を持つカードを好きなだけ魂状態を含む煌臨元スピリットの下に追加できる。",
    ],
    adventData: {
      adventCondition: {
        cardNames: [{ contains: "水篠 旬" }],
        isContract: true,
        targetCategory: ["spirit"],
      },
      adventTiming: "own_turn",
      soulCoreDest: "this_card",
      adventVariant: "contract",
      includeAdventSourceTarget: true,
      declareUsageLimit: { kind: "per_card_name", duration: "turn" },
      declareCondition: [{ kind: "count_value", player: "self", min: 7 }],
      beforeAdventSourceAddition: {
        fromZones: ["hand", "trash"],
        filter: { tribes: ["プレイヤー"] },
        textRef: [3],
      },
      chargeCoresOnAdvent: true,
      adventSourceZone: "trash",
      alternateCostAdvent: {
        condition: [{ kind: "count_value", player: "self", min: 1 }],
        timing: "own_turn",
      },
    },
    effects: [],
  },
  {
    cardNo: "TEST-TENSHO",
    textLines: [
      "【転召：1／幻想＆コスト3以上／ボイド】",
      "召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低1個）をボイドに置かなければならない。",
    ],
    tenshoSummon: {
      targetFilter: {
        category: ["spirit"],
        tribesRequired: ["幻想"],
        minCost: 3,
      },
      minCores: 1,
      destination: "void",
    },
    effects: [],
  },
  {
    cardNo: "TEST-TENSHO-BROKEN",
    textLines: [
      "【転召：1／幻想＆コスト3以上／ボイド】",
      "召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低1個）をボイドに置かなければならない。",
    ],
    tenshoSummon: {
      targetFilter: {
        category: ["spirit"],
        tribesRequired: ["幻想"],
        minCost: 3,
      },
      minCores: 2,
      destination: "void",
    },
    effects: [],
  },
  {
    cardNo: "TEST-GRANDSTONE",
    isDoubleSided: true,
    backFace: {
      cardNo: "TEST-GRANDSTONE(B)",
      printedCategory: "brave",
      textLines: [],
    },
    textLines: [
      "このネクサスは創界石ネクサス対象の効果しか受けない。このネクサスには解放と創界石ネクサス対象の効果でしかコアを置けず、そのコアは創界石ネクサス対象の効果しか受けず移動できない。",
      "【解封：〔カード名に「博麗」を含む／系統：「靈異」を持つ自分のスピリットの召喚／アタック〕】",
      "◆解放条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。",
      "Lv1【転醒：自分のカウント3以下（転醒は同時に使えない）】",
      "このネクサスのコアが3個以上になったとき、このネクサスを裏返せる。（置かれているコアすべてをボイドに置く。）このとき、この転醒後ブレイヴは自分のスピリットに合体できる。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandstoneData: {
      unsealConditions: [
        {
          events: ["summon", "attack"],
          cardFilter: { nameContains: ["博麗"], categories: ["spirit"] },
        },
        {
          events: ["summon", "attack"],
          cardFilter: { tribes: ["靈異"], categories: ["spirit"] },
        },
      ],
      rebirthCoreThreshold: 3,
      rebirthMaxCount: 3,
      rebirthRetainCores: 0,
      postRebirth: "combine_with_own_spirit",
    },
    effects: [],
  },
  {
    cardNo: "TEST-GRANDSTONE-BROKEN",
    textLines: [
      "このネクサスのコアが3個以上になったとき、このネクサスを裏返せる。（置かれているコアすべてをボイドに置く。）このとき、この転醒後ブレイヴは自分のスピリットに合体できる。",
    ],
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandstoneData: {
      unsealConditions: [],
      rebirthCoreThreshold: 2,
      rebirthMaxCount: 3,
      rebirthRetainCores: 0,
      postRebirth: "combine_with_own_spirit",
    },
    effects: [],
  },
  {
    cardNo: "TEST-MIRAGE-SET-EXEMPTION",
    textLines: [
      "セットしている/手札にあるこのカードは、自分のセット可能枚数に数えない。この効果は重複せず、ターンに1回しか使えない。",
    ],
    mirageData: {
      cost: 2,
      reduction: ["purple"],
      exemptSetCountLimits: true,
    },
    effects: [],
  },
  {
    cardNo: "TEST-MIRAGE-SET-EXEMPTION-BROKEN",
    textLines: [
      "セットしている/手札にあるこのカードは、自分のセット可能枚数に数えない。この効果は重複せず、ターンに1回しか使えない。",
    ],
    mirageData: { cost: 2, reduction: ["purple"] },
    effects: [],
  },
  {
    cardNo: "TEST-GUIDED-NEXUS-RULE",
    textLines: [
      "このネクサス/スピリットは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサス/スピリットには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・転者・導域は、神託・転神・神域としても扱う。",
    ],
    keywordTags: ["guided_nexus"],
    grandwalkerData: { kind: "guided", oracleConditions: [] },
    effects: [],
  },
  {
    cardNo: "TEST-GUIDED-NEXUS-RULE-BROKEN",
    textLines: [
      "このネクサス/スピリットは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサス/スピリットには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・転者・導域は、神託・転神・神域としても扱う。",
    ],
    keywordTags: ["guided_nexus"],
    grandwalkerData: { kind: "grandwalker", oracleConditions: [] },
    effects: [],
  },
];

const mechanicsCarrierLedger = buildTextAccountabilityLedger({
  cards: mechanicsCarrierCards,
  testFileContents: testFiles,
  discoveredTestTitles,
});
const validStone = mechanicsCarrierCards.find(
  (card) => card.cardNo === "TEST-GRANDSTONE"
);
const printedStoneProfiles = [
  {
    header:
      "【解封：〔自分の「アリス邸」／系統：「導魔」／「動玩」を持つスピリットの召喚／転醒〕】",
    body: "このネクサスのコアが3個以上になったとき、このネクサスを裏返せる。（置かれているコアすべてはボイドに置かれる）このとき、この転醒後ブレイヴは自分のスピリットに合体できる。この転醒で【解封】はできない。",
    data: {
      unsealConditions: [
        {
          events: ["summon", "rebirth"],
          cardFilter: { nameContains: ["アリス邸"] },
        },
        {
          events: ["summon", "rebirth"],
          cardFilter: { tribes: ["導魔", "動玩"], categories: ["spirit"] },
        },
      ],
      rebirthCoreThreshold: 3,
      rebirthMaxCount: 9,
      rebirthRetainCores: 0,
      postRebirth: "combine_with_own_spirit",
      rebirthExcludedFromUnseal: true,
    },
    backCategory: "brave",
  },
  ...[
    {
      header:
        "【解封：〔系統：「楽族」／「冥主」を持つ自分の効果による自分の手札の増加〕】",
      condition: {
        events: ["hand_increase"],
        causeFilter: { tribes: ["楽族", "冥主"] },
      },
      charge: false,
    },
    {
      header: "【解封：〔系統：「地霊」を持つ自分のスピリットのアタック〕】",
      condition: {
        events: ["attack"],
        cardFilter: { tribes: ["地霊"], categories: ["spirit"] },
      },
      charge: true,
    },
    {
      header:
        "【解封：〔系統：「起幻」を持つ自分の青の効果による自分の手札の増加〕】",
      condition: {
        events: ["hand_increase"],
        causeFilter: { tribes: ["起幻"], colors: ["blue"] },
      },
      charge: true,
    },
  ].map(({ header, condition, charge }) => ({
    header,
    body:
      "このネクサスのコアが4個以上になったとき、このネクサスを裏返せる。（置かれているコアは1個を残してボイドに置く。）" +
      (charge
        ? "このとき、自分のフィールド/リザーブのコアを好きなだけこの転醒後スピリットに置ける。"
        : ""),
    data: {
      unsealConditions: [condition],
      rebirthCoreThreshold: 4,
      rebirthMaxCount: 5,
      rebirthRetainCores: 1,
      ...(charge ? { postRebirth: "charge_cores_from_field_reserve" } : {}),
    },
    backCategory: "spirit",
  })),
];
for (const [index, profile] of printedStoneProfiles.entries()) {
  const face = {
    cardNo: `TEST-PRINTED-STONE-${index}`,
    textLines: [
      profile.header,
      "◆ 解封条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。",
      `Lv1【転醒：自分のカウント${profile.data.rebirthMaxCount}以下（転醒は同時に使えない）】`,
      profile.body,
      "このネクサスは創界石ネクサス対象の効果しか受けない。このネクサスには解封と創界石ネクサス対象の効果でしかコアを置けず、そのコアは創界石ネクサス対象の効果しか受けず移動できない。",
    ],
    isDoubleSided: true,
    backFace: { printedCategory: profile.backCategory, textLines: [] },
    keywordTags: ["enter_field_core_placement_forbidden"],
    grandstoneData: profile.data,
    effects: [],
  };
  const ledgerFor = (card, files = testFiles, titles = discoveredTestTitles) =>
    buildTextAccountabilityLedger({
      cards: [card],
      testFileContents: files,
      discoveredTestTitles: titles,
    });
  const valid = ledgerFor(face);
  assert.ok(
    valid.entries.every((entry) => entry.source === "structured_carrier"),
    "all printed stone lines have exact executable carriers"
  );
  const changes = [
    (c) => c.grandstoneData.unsealConditions[0].events.push("place"),
    (c) =>
      c.grandstoneData.unsealConditions.push(
        c.grandstoneData.unsealConditions[0]
      ),
    (c) => {
      const f = c.grandstoneData.unsealConditions[0];
      (f.cardFilter ?? f.causeFilter).tribes = ["未印字"];
    },
    (c) => {
      c.grandstoneData.unsealConditions[0].unexpectedCondition = true;
    },
    (c) => c.grandstoneData.rebirthCoreThreshold++,
    (c) => c.grandstoneData.rebirthMaxCount++,
    (c) => c.grandstoneData.rebirthRetainCores++,
    (c) => {
      c.grandstoneData.postRebirth = profile.data.postRebirth
        ? undefined
        : "charge_cores_from_field_reserve";
    },
    (c) => {
      c.grandstoneData.rebirthExcludedFromUnseal =
        !profile.data.rebirthExcludedFromUnseal;
    },
    (c) => {
      c.isDoubleSided = false;
    },
    (c) => {
      c.backFace = undefined;
    },
    (c) => {
      c.backFace.printedCategory =
        profile.backCategory === "spirit" ? "brave" : "spirit";
    },
    (c) => {
      c.keywordTags = [];
    },
  ];
  if (index === 0)
    changes.push((c) =>
      c.grandstoneData.unsealConditions[1].cardFilter.tribes.pop()
    );
  if (index === 3)
    changes.push((c) => {
      delete c.grandstoneData.unsealConditions[0].causeFilter.colors;
    });
  for (const mutate of changes) {
    const broken = globalThis.structuredClone(face);
    mutate(broken);
    const ledger = ledgerFor(broken);
    for (const lineIndex of [0, 1, 3, 4])
      assert.equal(
        ledger.entries.find(
          (entry) => entry.id === `${face.cardNo}:textLines[${lineIndex}]`
        )?.source,
        "unclaimed",
        `printed stone ${index} rejects a broken complete data profile at line ${lineIndex}`
      );
  }
  const missingBoard = new Map(testFiles);
  missingBoard.delete(
    "packages/rules-core/test/printed-grandstone-carrier.test.ts"
  );
  assert.notEqual(
    ledgerFor(face, missingBoard).entries[0].status,
    "carrier_contract",
    "missing board evidence cannot credit a printed profile"
  );
}
assert.deepEqual(
  collectCoverageFindings([validStone]).filter(
    (issue) => issue.kind === "unaccounted_text_line"
  ),
  [],
  "per-face coverage must preserve the back-face metadata required by the rebirth carrier"
);
const stoneWithUnclaimedBack = {
  ...validStone,
  backFace: {
    ...validStone.backFace,
    textLines: ["裏面の未知の効果で1枚ドローできる。"],
    effects: [],
  },
};
const backReviews = collectCoverageFindings([stoneWithUnclaimedBack]).filter(
  (issue) => issue.kind === "unaccounted_text_line"
);
assert.equal(
  backReviews.length,
  1,
  "the back face remains audited exactly once"
);
assert.equal(backReviews[0].cardNo, "TEST-GRANDSTONE(B)");
for (const brokenFields of [
  { isDoubleSided: false },
  { isDoubleSided: undefined },
  { backFace: undefined },
  { backFace: { printedCategory: "spirit", textLines: [] } },
]) {
  const brokenLedger = buildTextAccountabilityLedger({
    cards: [{ ...validStone, ...brokenFields }],
    testFileContents: testFiles,
    discoveredTestTitles,
  });
  assert.equal(
    brokenLedger.entries.find(
      (entry) => entry.id === "TEST-GRANDSTONE:textLines[4]"
    )?.source,
    "unclaimed",
    "stone rebirth body requires a double-sided card with a real brave back face"
  );
  assert.ok(
    collectCoverageFindings([{ ...validStone, ...brokenFields }]).some(
      (issue) =>
        issue.kind === "unaccounted_text_line" &&
        issue.cardNo === "TEST-GRANDSTONE" &&
        issue.textRef.includes(4)
    ),
    "per-face coverage must also reject an execution-blocking flip definition"
  );
}
for (const cardNo of [
  "TEST-SPACED-CONTRACT-ADVENT",
  "TEST-SUPER-CONTRACT-ADVENT",
  "TEST-TENSHO",
  "TEST-GRANDSTONE",
  "TEST-MIRAGE-SET-EXEMPTION",
  "TEST-GUIDED-NEXUS-RULE",
]) {
  const entries = mechanicsCarrierLedger.entries.filter((entry) =>
    entry.id.startsWith(`${cardNo}:`)
  );
  assert.ok(
    entries.length > 0,
    `${cardNo} must produce accountability entries`
  );
  assert.ok(
    entries.every((entry) => entry.source === "structured_carrier"),
    `${cardNo} must be credited only by its exact structured carrier`
  );
}
for (const [cardNo, lineIndex] of [
  ["TEST-SPACED-CONTRACT-ADVENT-BROKEN", 0],
  ["TEST-SPACED-CONTRACT-ADVENT-HIDDEN-C7-BROKEN", 0],
  ["TEST-SUPER-CONTRACT-ADVENT-BROKEN", 1],
  ["TEST-SUPER-CONTRACT-ADVENT-HIDDEN-DATA-BROKEN", 1],
  ["TEST-TENSHO-BROKEN", 0],
  ["TEST-TENSHO-BROKEN", 1],
  ["TEST-GRANDSTONE-BROKEN", 0],
  ["TEST-MIRAGE-SET-EXEMPTION-BROKEN", 0],
  ["TEST-GUIDED-NEXUS-RULE-BROKEN", 0],
]) {
  assert.equal(
    mechanicsCarrierLedger.entries.find(
      (entry) => entry.id === `${cardNo}:textLines[${lineIndex}]`
    )?.source,
    "unclaimed",
    `${cardNo} must remain reviewable when one printed requirement is not carried`
  );
}

const underCardSlotTestCards = [
  {
    cardNo: "TEST-ALDNOAH-DRIVE-SLOT",
    textLines: [
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける）",
    ],
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 1 }],
    effects: [],
  },
  {
    cardNo: "TEST-ALDNOAH-DRIVE-SLOT-BROKEN",
    textLines: [
      "【アルドノアドライブ：1】（このアルティメットの下に「アルドノアドライブ」を1枚まで置ける）",
    ],
    underCardSlots: [{ roleTag: "アルドノアドライブ", maxCount: 2 }],
    effects: [],
  },
];

const underCardSlotLedger = buildTextAccountabilityLedger({
  cards: underCardSlotTestCards,
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.equal(
  underCardSlotLedger.entries.find(
    (entry) => entry.id === "TEST-ALDNOAH-DRIVE-SLOT:textLines[0]"
  )?.source,
  "structured_carrier",
  "matching roleTag and capacity must account for an Aldnoah Drive declaration"
);
assert.equal(
  underCardSlotLedger.entries.find(
    (entry) => entry.id === "TEST-ALDNOAH-DRIVE-SLOT-BROKEN:textLines[0]"
  )?.source,
  "unclaimed",
  "a mismatched slot capacity must remain reviewable rather than being treated as a carrier"
);

const starGarmentCannotBeUnderLedger = buildTextAccountabilityLedger({
  cards: [
    {
      cardNo: "TEST-STAR-GARMENT-CANNOT-BE-UNDER",
      textLines: ["このカードは、【星霊衣】で自分のスピリットの下に置けない。"],
      keywordTags: ["star_garment_cannot_be_under"],
      effects: [],
    },
    {
      cardNo: "TEST-STAR-GARMENT-CANNOT-BE-UNDER-BROKEN",
      textLines: ["このカードは、【星霊衣】で自分のスピリットの下に置けない。"],
      keywordTags: ["star_garment"],
      effects: [],
    },
  ],
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.equal(
  starGarmentCannotBeUnderLedger.entries.find(
    (entry) => entry.id === "TEST-STAR-GARMENT-CANNOT-BE-UNDER:textLines[0]"
  )?.source,
  "structured_carrier",
  "the B-face cannot-be-under tag must account for its exact Star Garment restriction"
);
assert.equal(
  starGarmentCannotBeUnderLedger.entries.find(
    (entry) =>
      entry.id === "TEST-STAR-GARMENT-CANNOT-BE-UNDER-BROKEN:textLines[0]"
  )?.source,
  "unclaimed",
  "a generic Star Garment tag must not mask a missing cannot-be-under restriction"
);

const levelHeadingCarrierLedger = buildTextAccountabilityLedger({
  cards: [
    {
      cardNo: "TEST-LEVEL-HEADING",
      textLines: ["Lv1-Lv2-Lv3", "全Lvで実装済みの継続効果。"],
      levelDefs: [{ level: 1 }, { level: 2 }, { level: 3 }],
      effects: [{ textRef: [1], steps: [] }],
    },
    {
      cardNo: "TEST-LEVEL-HEADING-BROKEN",
      textLines: ["Lv1-Lv2-Lv3", "Lv3 の範囲が定義にない本文。"],
      levelDefs: [{ level: 1 }, { level: 2 }],
      effects: [{ textRef: [1], steps: [] }],
    },
  ],
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.equal(
  levelHeadingCarrierLedger.entries.find(
    (entry) => entry.id === "TEST-LEVEL-HEADING:textLines[0]"
  )?.source,
  "structured_carrier",
  "an exact all-level heading must be attributed to the printed level definitions"
);
assert.equal(
  levelHeadingCarrierLedger.entries.find(
    (entry) => entry.id === "TEST-LEVEL-HEADING-BROKEN:textLines[0]"
  )?.source,
  "unclaimed",
  "a heading that names an undefined level must remain reviewable"
);

const declarationCarrierLedger = buildTextAccountabilityLedger({
  cards: [
    {
      cardNo: "TEST-ADDITIONAL-BRAVE-SLOT",
      textLines: [
        "〔重複不可〕このカード/ブレイヴは、「テスト名」が合体している自分のスピリットに追加で合体できる。",
      ],
      additionalBraveSlot: {
        hostCondition: { categories: ["spirit"] },
        requiredAttachedBraveNameContains: ["テスト名"],
        maxPerHost: 1,
      },
      effects: [],
    },
    {
      cardNo: "TEST-ADDITIONAL-BRAVE-SLOT-BROKEN",
      textLines: [
        "〔重複不可〕このカード/ブレイヴは、「テスト名」が合体している自分のスピリットに追加で合体できる。",
      ],
      effects: [],
    },
    {
      cardNo: "TEST-ADDITIONAL-BRAVE-SLOT-MISMATCHED",
      textLines: [
        "〔重複不可〕このカード/ブレイヴは、「テスト名」が合体している自分のスピリットに追加で合体できる。",
      ],
      additionalBraveSlot: {
        hostCondition: { categories: ["spirit"] },
        requiredAttachedBraveNameContains: ["別名"],
        maxPerHost: 1,
      },
      effects: [],
    },
    {
      cardNo: "TEST-ADDITIONAL-BRAVE-SLOT-MAX-0",
      textLines: [
        "〔重複不可〕このカード/ブレイヴは、「テスト名」が合体している自分のスピリットに追加で合体できる。",
      ],
      additionalBraveSlot: {
        hostCondition: { categories: ["spirit"] },
        requiredAttachedBraveNameContains: ["テスト名"],
        maxPerHost: 0,
      },
      effects: [],
    },
    {
      cardNo: "TEST-ADDITIONAL-BRAVE-SLOT-MAX-2",
      textLines: [
        "〔重複不可〕このカード/ブレイヴは、「テスト名」が合体している自分のスピリットに追加で合体できる。",
      ],
      additionalBraveSlot: {
        hostCondition: { categories: ["spirit"] },
        requiredAttachedBraveNameContains: ["テスト名"],
        maxPerHost: 2,
      },
      effects: [],
    },
    {
      cardNo: "TEST-CANNOT-COMBINE",
      textLines: ["【合体条件：合体不可】"],
      keywordTags: ["cannot_combine"],
      effects: [],
    },
    {
      cardNo: "TEST-CANNOT-COMBINE-BROKEN",
      textLines: ["【合体条件：合体不可】"],
      keywordTags: [],
      effects: [],
    },
    {
      cardNo: "TEST-CANNOT-COMBINE-PLAIN",
      textLines: ["このスピリットは合体できない。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { level: { min: 1, max: 3 } },
          steps: [
            {
              action: {
                kind: "override_properties",
                target: { kind: "self" },
                properties: { keywords: ["cannot_combine"] },
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    },
    {
      cardNo: "TEST-CANNOT-COMBINE-PLAIN-BROKEN",
      textLines: ["このスピリットは合体できない。"],
      keywordTags: [],
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { level: { min: 1, max: 3 } },
          steps: [
            {
              action: {
                kind: "override_properties",
                target: { kind: "self" },
                properties: {},
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    },
    {
      cardNo: "TEST-MAX-DECK-COUNT",
      textLines: ["このカードは、20枚までデッキに入れられる。"],
      maxDeckCount: 20,
      effects: [],
    },
    {
      cardNo: "TEST-MAX-DECK-COUNT-BROKEN",
      textLines: ["このカードは、20枚までデッキに入れられる。"],
      maxDeckCount: 3,
      effects: [],
    },
  ],
  testFileContents: testFiles,
  discoveredTestTitles,
});
for (const cardNo of [
  "TEST-ADDITIONAL-BRAVE-SLOT",
  "TEST-CANNOT-COMBINE",
  "TEST-CANNOT-COMBINE-PLAIN",
  "TEST-MAX-DECK-COUNT",
]) {
  assert.equal(
    declarationCarrierLedger.entries.find(
      (entry) => entry.id === `${cardNo}:textLines[0]`
    )?.source,
    "structured_carrier",
    `${cardNo} must be accounted for by its exact declarative carrier`
  );
}
for (const cardNo of [
  "TEST-ADDITIONAL-BRAVE-SLOT-BROKEN",
  "TEST-ADDITIONAL-BRAVE-SLOT-MISMATCHED",
  "TEST-ADDITIONAL-BRAVE-SLOT-MAX-0",
  "TEST-ADDITIONAL-BRAVE-SLOT-MAX-2",
  "TEST-CANNOT-COMBINE-BROKEN",
  "TEST-CANNOT-COMBINE-PLAIN-BROKEN",
  "TEST-MAX-DECK-COUNT-BROKEN",
]) {
  assert.equal(
    declarationCarrierLedger.entries.find(
      (entry) => entry.id === `${cardNo}:textLines[0]`
    )?.source,
    "unclaimed",
    `${cardNo} must remain reviewable when its carrier is absent or inconsistent`
  );
}

const missingTribalCombineCarrier = buildTextAccountabilityLedger({
  cards: [
    {
      cardNo: "TEST-TRIBAL-COMBINE-MISSING-CARRIER",
      textLines: [
        "Lv1-Lv2",
        "このスピリットは系統：「導魔」を持つブレイヴ3つまで合体できる。",
      ],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 1000 },
        { level: 2, requiredCores: 2, bp: 2000 },
      ],
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { level: { min: 1, max: 2 } },
          textRef: [1],
          steps: [],
        },
      ],
    },
  ],
});
assert.equal(
  missingTribalCombineCarrier.entries.find(
    (entry) => entry.id === "TEST-TRIBAL-COMBINE-MISSING-CARRIER:textLines[1]"
  )?.source,
  "effects.textRef",
  "textRef attribution must not be mistaken for a structured brave-limit carrier"
);
const missingTribalCombineReview = collectCoverageFindings([
  {
    cardNo: "TEST-TRIBAL-COMBINE-MISSING-CARRIER",
    textLines: [
      "Lv1-Lv2",
      "このスピリットは系統：「導魔」を持つブレイヴ3つまで合体できる。",
    ],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 1000 },
      { level: 2, requiredCores: 2, bp: 2000 },
    ],
    effects: [
      {
        timing: { kind: "continuous" },
        applicability: { level: { min: 1, max: 2 } },
        textRef: [1],
        steps: [],
      },
    ],
  },
]);
assert.equal(
  missingTribalCombineReview.find((issue) => issue.effectPath === "effects[0]")
    ?.kind,
  "empty_effect_steps",
  "a missing maxCombinedBraves carrier must remain a review instead of crashing the audit"
);

const rebirthCountCarrierLedger = buildTextAccountabilityLedger({
  cards: [
    {
      cardNo: "BSTH09.2-転醒R03(A)",
      textLines: [],
      effects: [{ steps: [{ action: { kind: "rebirth", maxCount: 3 } }] }],
      backFace: {
        cardNo: "BSTH09.2-転醒R03(B)",
        textLines: ["この面に裏返ったとき、フィールドに残り、カウント1する。"],
        effects: [],
      },
    },
    {
      cardNo: "TEST-REBIRTH-COUNT(A)",
      textLines: [],
      effects: [{ steps: [{ action: { kind: "rebirth", maxCount: 3 } }] }],
      backFace: {
        cardNo: "TEST-REBIRTH-COUNT(B)",
        textLines: ["この面に裏返ったとき、フィールドに残り、カウント1する。"],
        effects: [],
      },
    },
    {
      cardNo: "TEST-REBIRTH-COUNT-BROKEN(A)",
      textLines: [],
      effects: [
        {
          steps: [
            {
              action: {
                kind: "rebirth",
                maxCount: 3,
                countBonusMode: "none",
              },
            },
          ],
        },
      ],
      backFace: {
        cardNo: "TEST-REBIRTH-COUNT-BROKEN(B)",
        textLines: ["この面に裏返ったとき、フィールドに残り、カウント1する。"],
        effects: [],
      },
    },
    {
      cardNo: "TEST-REBIRTH-COUNT-SPELLING(A)",
      textLines: [],
      effects: [{ steps: [{ action: { kind: "rebirth", maxCount: 3 } }] }],
      backFace: {
        cardNo: "TEST-REBIRTH-COUNT-SPELLING(B)",
        textLines: [
          "この面に裏返ったとき、フィールドに残り、カウントを1する。",
        ],
        effects: [],
      },
    },
  ],
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.equal(
  rebirthCountCarrierLedger.entries.find(
    (entry) => entry.id === "BSTH09.2-転醒R03(B):textLines[0]"
  )?.source,
  "structured_carrier",
  "the explicitly adjudicated B-face count-1 spelling requires its parent rebirth default increment carrier"
);
assert.equal(
  rebirthCountCarrierLedger.entries.find(
    (entry) => entry.id === "TEST-REBIRTH-COUNT-BROKEN(B):textLines[0]"
  )?.source,
  "unclaimed",
  "a parent rebirth that disables the count bonus must remain reviewable"
);
assert.equal(
  rebirthCountCarrierLedger.entries.find(
    (entry) => entry.id === "TEST-REBIRTH-COUNT(B):textLines[0]"
  )?.source,
  "unclaimed",
  "an unadjudicated card must not inherit BSTH09.2-転醒R03(B)'s count-1 ruling"
);
assert.equal(
  rebirthCountCarrierLedger.entries.find(
    (entry) => entry.id === "TEST-REBIRTH-COUNT-SPELLING(B):textLines[0]"
  )?.source,
  "unclaimed",
  "the adjudicated count-1 carrier must not accept an unadjudicated spelling variant"
);

const overrides = {
  accounts: {
    "TEST-EXEMPT:textLines[0]": {
      kind: "exemption",
      reason: "fixture-specific explicit exemption",
    },
    "TEST-CARRIER-OVERRIDE:textLines[0]": {
      kind: "structured_carrier",
      carrierPath: "adventData",
      behavior: "fixture-carrier-behavior",
      testRefs: ["packages/rules-core/test/test-card.test.ts"],
      testEvidence: {
        testRef: "packages/rules-core/test/test-card.test.ts",
        testName: "TEST-CARRIER-OVERRIDE fixture-carrier-behavior",
      },
      reason: "fixture requires an explicit carrier behavior contract",
    },
  },
};

const artsPlacementCarrierCard = {
  cardNo: "BSLH01-T08",
  textLines: [
    "【アーツ：(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回:同名〕アタックステップに使用できる）】",
    "〔<地>4 <風>1〕/〔<水>6〕",
  ],
  continuousSummonCondition: true,
  summonCondition: [
    {
      kind: "any_of",
      groups: [
        [
          { kind: "quartz_attribute", player: "self", attribute: "地", min: 4 },
          { kind: "quartz_attribute", player: "self", attribute: "風", min: 1 },
        ],
        [{ kind: "quartz_attribute", player: "self", attribute: "水", min: 6 }],
      ],
    },
  ],
  effects: [],
};
const artsPlacementCarrierLedger = buildTextAccountabilityLedger({
  cards: [artsPlacementCarrierCard],
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.deepEqual(
  artsPlacementCarrierLedger.entries.map((entry) => entry.status),
  ["carrier_contract", "carrier_contract"],
  "the full 【アーツ】 header and every source threshold group require the same continuous placement carrier"
);

const brokenArtsPlacementCarrierLedger = buildTextAccountabilityLedger({
  cards: [
    {
      ...artsPlacementCarrierCard,
      summonCondition: [
        {
          ...artsPlacementCarrierCard.summonCondition[0],
          groups: [
            [
              {
                kind: "quartz_attribute",
                player: "self",
                attribute: "地",
                min: 3,
              },
              {
                kind: "quartz_attribute",
                player: "self",
                attribute: "風",
                min: 1,
              },
            ],
            [
              {
                kind: "quartz_attribute",
                player: "self",
                attribute: "水",
                min: 6,
              },
            ],
          ],
        },
      ],
    },
  ],
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.deepEqual(
  brokenArtsPlacementCarrierLedger.entries.map((entry) => entry.source),
  ["unclaimed", "unclaimed"],
  "a weakened Arts threshold must stay reviewable instead of being credited by its header"
);

const unevidencedArtsPlacementLedger = buildTextAccountabilityLedger({
  cards: [
    {
      ...artsPlacementCarrierCard,
      // この run の実盤面 batch 外の番号は、同じ印字形でも未帰属に保つ。
      // Keeping it unclaimed proves the carrier
      // is evidence-scoped rather than a broad text-pattern suppression.
      cardNo: "BSLH01-T18",
    },
  ],
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.deepEqual(
  unevidencedArtsPlacementLedger.entries.map((entry) => entry.source),
  ["unclaimed", "unclaimed"],
  "a matching Arts card without this batch's board evidence must remain reviewable"
);

const unconditionalTribeCard = {
  cardNo: "TEST-TRIBES",
  printedCategory: "magic",
  tribe: "幻想・紅魔",
  textLines: ["このカードは、系統：「幻想」/「紅魔」を持つ。"],
  effects: [],
};
const tribeLedger = (overrides = {}) =>
  buildTextAccountabilityLedger({
    cards: [{ ...unconditionalTribeCard, ...overrides }],
    testFileContents: testFiles,
    discoveredTestTitles,
  });
for (const overrides of [
  {},
  { tribe: "紅魔・幻想" },
  { tribe: ["幻想", "紅魔"] },
  {
    printedCategory: "nexus",
    textLines: ["このカード/ネクサスは、系統：「幻想」/「紅魔」を持つ。"],
  },
]) {
  assert.deepEqual(
    tribeLedger(overrides).entries.map((entry) => entry.status),
    ["carrier_contract"]
  );
}
for (const overrides of [
  { tribe: undefined },
  { tribe: "幻想" },
  { tribe: "幻想・紅魔・導魔" },
  { tribe: "幻想・紅魔・紅魔" },
  { tribe: "幻想・・紅魔" },
  { tribe: ["幻想", null, "紅魔"] },
  { tribe: "紅魔館・幻想" },
  { textLines: ["このカード/ネクサスは、系統：「幻想」/「紅魔」を持つ。"] },
  {
    textLines: [
      "フィールドにあるこのカードは、系統：「幻想」/「紅魔」を持つ。",
    ],
  },
  {
    textLines: ["このカードは、系統：「幻想」/「紅魔」を持ち、1枚ドローする。"],
  },
  { textLines: ["このカードは、系統：「幻想」/「幻想」を持つ。"] },
]) {
  assert.deepEqual(
    tribeLedger(overrides).entries.map((entry) => entry.source),
    ["unclaimed"]
  );
}
const missingTribeTests = buildTextAccountabilityLedger({
  cards: [unconditionalTribeCard],
});
assert.equal(missingTribeTests.entries[0].status, "invalid_carrier");

const initial = buildTextAccountabilityLedger({
  cards,
  overrides,
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.equal(initial.totals.nonblank, 10);
assert.equal(initial.totals.newUnaccounted, 2);
assert.equal(initial.gate.clean, false);
assert.equal(
  initial.entries.find((entry) => entry.id === "TEST-CARD:textLines[0]")
    ?.status,
  "new_unaccounted",
  "unheaded operational text must not be skipped"
);
assert.equal(
  initial.entries.find((entry) => entry.id === "TEST-CARD:textLines[0]")
    ?.actionable,
  true,
  "all unclaimed text must remain an actionable backlog item"
);
assert.equal(
  initial.entries.find((entry) => entry.id === "TEST-CARD:textLines[0]")
    ?.executionLike,
  false,
  "execution-like wording is priority metadata, not the backlog inclusion gate"
);
assert.equal(
  initial.entries.find((entry) => entry.id === "TEST-CARD:textLines[2]")
    ?.status,
  "structural_only",
  "textRef maps structure but must not claim semantic equivalence"
);
assert.equal(
  initial.entries.find((entry) => entry.id === "TEST-CARD:textLines[3]")
    ?.status,
  "carrier_contract"
);
assert.equal(
  initial.entries.find((entry) => entry.id === "TEST-RULE:textLines[0]")
    ?.status,
  "general_rule"
);
assert.equal(
  initial.entries.find(
    (entry) => entry.id === "TEST-RULE-REMAINING:textLines[0]"
  )?.status,
  "general_rule",
  "remaining-count spelling is the same rebirth rule boilerplate"
);
assert.equal(
  initial.entries.find(
    (entry) => entry.id === "TEST-RULE-ANNOTATED:textLines[0]"
  )?.status,
  "general_rule",
  "a parenthetical note must not turn the rebirth rule boilerplate into an effect"
);
assert.equal(
  initial.entries.find(
    (entry) => entry.id === "TEST-RULE-AMBIGUOUS:textLines[0]"
  )?.status,
  "new_unaccounted",
  "a missing plus sign remains visible for source correction or ruling rather than being silently normalized"
);
assert.equal(
  initial.entries.find((entry) => entry.id === "TEST-EXEMPT:textLines[0]")
    ?.status,
  "exemption"
);
assert.equal(
  initial.entries.find(
    (entry) => entry.id === "TEST-CARRIER-OVERRIDE:textLines[0]"
  )?.status,
  "carrier_contract"
);

const inferredHeading = buildTextAccountabilityLedger({
  cards: [
    {
      cardNo: "TEST-CONTEXT",
      textLines: ["Lv1『このスピリットの召喚時』", "本文は直接参照済み。"],
      effects: [{ textRef: [1], steps: [] }],
    },
  ],
  testFileContents: testFiles,
});
assert.equal(
  inferredHeading.entries.find(
    (entry) => entry.id === "TEST-CONTEXT:textLines[0]"
  )?.status,
  "new_unaccounted",
  "a heading without direct textRef must not inherit an arbitrary effect from its block"
);

const invalidCarrierOverride = buildTextAccountabilityLedger({
  cards,
  overrides: {
    accounts: {
      ...overrides.accounts,
      "TEST-CARRIER-OVERRIDE:textLines[0]": {
        ...overrides.accounts["TEST-CARRIER-OVERRIDE:textLines[0]"],
        carrierPath: "missingCarrier",
      },
    },
  },
  testFileContents: testFiles,
});
assert.equal(invalidCarrierOverride.gate.clean, false);
assert.equal(
  invalidCarrierOverride.entries.find(
    (entry) => entry.id === "TEST-CARRIER-OVERRIDE:textLines[0]"
  )?.status,
  "invalid_override",
  "an override carrier path must resolve on the card face"
);

const commentOnlyCarrierEvidence = buildTextAccountabilityLedger({
  cards,
  overrides,
  testFileContents: new Map([
    ...testFiles,
    [
      "packages/rules-core/test/bsaz02-c01-alguile.test.ts",
      '// it("自分の場に「ＣＦ」アルティメットが0体なら召喚可", () => {});',
    ],
  ]),
});
assert.equal(commentOnlyCarrierEvidence.gate.clean, false);
assert.equal(
  commentOnlyCarrierEvidence.entries.find(
    (entry) => entry.id === "TEST-CARD:textLines[3]"
  )?.status,
  "invalid_carrier",
  "a comment that names a test is not executable carrier evidence"
);

const invalidGeneralRuleOverride = buildTextAccountabilityLedger({
  cards,
  overrides: {
    accounts: {
      ...overrides.accounts,
      "TEST-RULE:textLines[0]": {
        kind: "general_rule",
        ruleRef: "manual/ai-reference/10_rules/missing.md:1",
        behavior: "fixture-general-rule",
        testRefs: ["packages/rules-core/test/test-card.test.ts"],
        testEvidence: {
          testRef: "packages/rules-core/test/test-card.test.ts",
          testName: "TEST-RULE fixture-general-rule",
        },
        reason: "fixture verifies rule source validation",
      },
    },
  },
  testFileContents: new Map([
    ...testFiles,
    [
      "packages/rules-core/test/test-card.test.ts",
      'it("TEST-CARRIER-OVERRIDE fixture-carrier-behavior", () => {}); it("TEST-RULE fixture-general-rule", () => {});',
    ],
  ]),
});
assert.equal(invalidGeneralRuleOverride.gate.clean, false);
assert.equal(
  invalidGeneralRuleOverride.entries.find(
    (entry) => entry.id === "TEST-RULE:textLines[0]"
  )?.status,
  "invalid_override",
  "a general-rule override must resolve an extant rule source and range"
);

const baseline = createLegacyBaseline(initial);
assert.deepEqual(validateInitialLegacyBaseline(initial, baseline), []);
const withBaseline = buildTextAccountabilityLedger({
  cards,
  baseline,
  overrides,
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.equal(withBaseline.gate.clean, true);
assert.equal(withBaseline.totals.legacyActionable, 2);
assert.equal(withBaseline.totals.actionableLegacy, 2);

const correctionId = "TEST-CARRIER-OVERRIDE:textLines[0]";
const originalCard = cards.find(
  (card) => card.cardNo === "TEST-CARRIER-OVERRIDE"
);
const correctedCard = {
  ...originalCard,
  textLines: ["訂正された carrier contract の本文。"],
};
const correctionBaseline = createLegacyBaseline(
  buildTextAccountabilityLedger({ cards: [originalCard] })
);
const sourceCorrection = {
  previousTextHash: sourceHash(originalCard.textLines[0]),
  correctedTextHash: sourceHash(correctedCard.textLines[0]),
  reason: "ユーザー指定の原文訂正。実装は回帰テストで検証する。",
};
const correctionAccount = {
  ...overrides.accounts[correctionId],
  sourceCorrection,
};
const correctionReport = (
  account = correctionAccount,
  card = correctedCard,
  evidence = discoveredTestTitles
) =>
  buildTextAccountabilityLedger({
    cards: [card],
    baseline: correctionBaseline,
    overrides: { accounts: { [correctionId]: account } },
    testFileContents: testFiles,
    discoveredTestTitles: evidence,
  });
const correctedSource = correctionReport();
assert.equal(correctedSource.gate.clean, true);
assert.deepEqual(
  correctedSource.resolvedBaselineEntries[0]?.sourceCorrection,
  sourceCorrection
);
assert.equal(
  correctionBaseline.legacyUnclaimed[correctionId].textHash,
  sourceCorrection.previousTextHash
);
for (const invalidCorrection of [
  undefined,
  null,
  { ...sourceCorrection, previousTextHash: "wrong" },
  { ...sourceCorrection, correctedTextHash: "wrong" },
  { ...sourceCorrection, reason: " " },
]) {
  assert.equal(
    correctionReport({
      ...correctionAccount,
      sourceCorrection: invalidCorrection,
    }).gate.clean,
    false
  );
}
assert.equal(
  correctionReport(correctionAccount, correctedCard, new Map()).gate.clean,
  false,
  "a correction cannot replace executable test evidence"
);
assert.equal(
  correctionReport(correctionAccount, {
    ...correctedCard,
    adventData: undefined,
  }).gate.clean,
  false,
  "a correction cannot replace a valid carrier"
);
assert.equal(
  correctionReport(correctionAccount, {
    ...correctedCard,
    textLines: ["さらに無記録で変更した本文。"],
  }).gate.clean,
  false,
  "a later source change needs a fresh correction record"
);
assert.equal(
  buildTextAccountabilityLedger({
    cards: [correctedCard],
    baseline: correctionBaseline,
  }).gate.clean,
  false,
  "unaccounted corrections remain failures"
);

const deletableCards = [
  {
    cardNo: "TEST-DELETE",
    textLines: ["既存の未帰属本文。"],
    effects: [],
  },
];
const deletionSeed = buildTextAccountabilityLedger({ cards: deletableCards });
const deletionBaseline = createLegacyBaseline(deletionSeed);
const deletedLegacy = buildTextAccountabilityLedger({
  cards: [],
  baseline: deletionBaseline,
});
assert.equal(deletedLegacy.gate.clean, false);
assert.equal(
  deletedLegacy.staleBaselineEntries[0]?.id,
  "TEST-DELETE:textLines[0]"
);
const resolvedLegacy = buildTextAccountabilityLedger({
  cards: [
    {
      ...deletableCards[0],
      effects: [{ textRef: [0], steps: [] }],
    },
  ],
  baseline: deletionBaseline,
});
assert.equal(resolvedLegacy.gate.clean, true);
assert.equal(
  resolvedLegacy.resolvedBaselineEntries[0]?.id,
  "TEST-DELETE:textLines[0]"
);

const preseededBaseline = {
  ...baseline,
  legacyUnclaimed: {
    ...baseline.legacyUnclaimed,
    "FUTURE-CARD:textLines[0]": {
      textHash: sourceHash("後から追加する未帰属本文。"),
      actionable: true,
      reason: "invalid future preseed fixture",
    },
  },
};
assert.deepEqual(validateInitialLegacyBaseline(initial, preseededBaseline), [
  "baseline entry is not a current unclaimed source line: FUTURE-CARD:textLines[0]",
]);

const manifestMismatchBaseline = {
  ...baseline,
  sourceManifestHash: "incorrect-manifest",
};
assert.deepEqual(
  validateInitialLegacyBaseline(initial, manifestMismatchBaseline),
  ["baseline sourceManifestHash does not match current source"]
);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "orica-text-evidence-"));
mkdirSync(join(fixtureRoot, "packages/rules-core/test"), { recursive: true });
symlinkSync(
  join(root, "node_modules"),
  join(fixtureRoot, "node_modules"),
  process.platform === "win32" ? "junction" : "dir"
);
writeFileSync(
  join(fixtureRoot, "vitest.config.mjs"),
  'export default { test: { include: ["packages/**/test/*.test.ts"] } };\n'
);
const temporaryBaselinePath = join(
  fixtureRoot,
  `.card-text-accountability-test-${process.pid}.json`
);
const cliCards = [cards[0]];
const cliInitial = buildTextAccountabilityLedger({
  cards: cliCards,
  testFileContents: testFiles,
  discoveredTestTitles,
});
const cliPreseededBaseline = {
  ...createLegacyBaseline(cliInitial),
  sourceGitBase: execFileSync("git", ["rev-parse", "main"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  legacyUnclaimed: {
    ...createLegacyBaseline(cliInitial).legacyUnclaimed,
    "FUTURE-CARD:textLines[0]": {
      textHash: sourceHash("後から追加する未帰属本文。"),
      actionable: true,
      reason: "invalid untracked future preseed fixture",
    },
  },
};
writeFileSync(
  temporaryBaselinePath,
  JSON.stringify(cliPreseededBaseline, null, 2) + "\n"
);
try {
  const cli = spawnSync(
    process.execPath,
    [join(scriptDir, "card-text-accountability-audit.mjs"), "--gate", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ORICA_TEXT_ACCOUNTABILITY_FIXTURE_JSON: JSON.stringify(cliCards),
        ORICA_TEXT_ACCOUNTABILITY_BASELINE_PATH: temporaryBaselinePath,
        ORICA_TEXT_ACCOUNTABILITY_NO_WRITE: "1",
        ORICA_TEXT_ACCOUNTABILITY_TEST_ROOT: fixtureRoot,
      },
    }
  );
  assert.equal(cli.status, 1, cli.stderr);
  const cliReport = JSON.parse(cli.stdout);
  assert.equal(cliReport.gate.clean, false);
  assert.ok(
    cliReport.gate.failures.some(
      (failure) =>
        failure.status === "invalid_baseline_seed" &&
        failure.reason.includes("FUTURE-CARD:textLines[0]")
    ),
    "the CLI gate must validate an untracked initial baseline before accepting it"
  );
} finally {
  rmSync(temporaryBaselinePath, { force: true });
}

const temporaryEvidenceTestFile = `.card-text-evidence-${process.pid}.test.ts`;
const temporaryEvidenceTestPath = join(
  fixtureRoot,
  "packages",
  "rules-core",
  "test",
  temporaryEvidenceTestFile
);
const temporaryEvidenceTestRef = `packages/rules-core/test/${temporaryEvidenceTestFile}`;
const temporaryEvidenceOverridesPath = join(
  fixtureRoot,
  `.card-text-evidence-overrides-${process.pid}.json`
);
const temporaryEvidenceBaselinePath = join(
  fixtureRoot,
  `.card-text-evidence-baseline-${process.pid}.json`
);
const discoveryCards = [
  {
    cardNo: "TEST-DISCOVERY",
    textLines: ["Vitest discovery evidence fixture."],
    adventData: { source: "fixture" },
    effects: [],
  },
];
writeFileSync(
  temporaryEvidenceOverridesPath,
  JSON.stringify(
    {
      accounts: {
        "TEST-DISCOVERY:textLines[0]": {
          kind: "structured_carrier",
          carrierPath: "adventData",
          behavior: "fixture-discovery-behavior",
          testRefs: [temporaryEvidenceTestRef],
          testEvidence: {
            testRef: temporaryEvidenceTestRef,
            testName: "TEST-DISCOVERY fixture-discovery-behavior",
          },
          reason:
            "fixture verifies Vitest discovery rather than source matching",
        },
      },
    },
    null,
    2
  ) + "\n"
);
try {
  writeFileSync(
    temporaryEvidenceTestPath,
    [
      'import { it } from "vitest";',
      'it.skip("TEST-DISCOVERY fixture-discovery-behavior", () => {});',
      'if (false) it("TEST-DISCOVERY fixture-discovery-behavior", () => {});',
      "const spoof = 'it(\"TEST-DISCOVERY fixture-discovery-behavior\", () => {})';",
      "void spoof;",
      "",
    ].join("\n")
  );
  const commonEvidenceEnv = {
    ...process.env,
    ORICA_TEXT_ACCOUNTABILITY_FIXTURE_JSON: JSON.stringify(discoveryCards),
    ORICA_TEXT_ACCOUNTABILITY_BASELINE_PATH: temporaryEvidenceBaselinePath,
    ORICA_TEXT_ACCOUNTABILITY_OVERRIDES_PATH: temporaryEvidenceOverridesPath,
    ORICA_TEXT_ACCOUNTABILITY_NO_WRITE: "1",
    ORICA_TEXT_ACCOUNTABILITY_TEST_ROOT: fixtureRoot,
  };
  const skippedEvidence = spawnSync(
    process.execPath,
    [join(scriptDir, "card-text-accountability-audit.mjs"), "--gate", "--json"],
    { cwd: root, encoding: "utf8", env: commonEvidenceEnv }
  );
  assert.equal(skippedEvidence.status, 1, skippedEvidence.stderr);
  const skippedEvidenceReport = JSON.parse(skippedEvidence.stdout);
  assert.equal(
    skippedEvidenceReport.entries[0]?.status,
    "invalid_override",
    "string literals, unreachable branches, and skip cases are not Vitest evidence"
  );

  writeFileSync(
    temporaryEvidenceTestPath,
    'import { it } from "vitest"; it("TEST-DISCOVERY fixture-discovery-behavior", () => {});\n'
  );
  const activeEvidence = spawnSync(
    process.execPath,
    [join(scriptDir, "card-text-accountability-audit.mjs"), "--gate", "--json"],
    { cwd: root, encoding: "utf8", env: commonEvidenceEnv }
  );
  assert.equal(activeEvidence.status, 0, activeEvidence.stderr);
  assert.equal(JSON.parse(activeEvidence.stdout).gate.clean, true);
} finally {
  rmSync(temporaryEvidenceTestPath, { force: true });
  rmSync(temporaryEvidenceOverridesPath, { force: true });
  rmSync(temporaryEvidenceBaselinePath, { force: true });
  // fixtureRoot was created above by mkdtemp; the node_modules junction itself
  // is removed, never its target in the real workspace.
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const changedCards = cards.map((card) => ({
  ...card,
  textLines: [...card.textLines],
}));
changedCards[0].textLines[0] = "見出しのない変更済み未帰属の実行本文。";
const changed = buildTextAccountabilityLedger({
  cards: changedCards,
  baseline,
  overrides,
  testFileContents: testFiles,
  discoveredTestTitles,
});
assert.equal(changed.gate.clean, false);
assert.equal(changed.totals.changedUnaccounted, 1);

const printedOraclePlacement =
  "◆このネクサスを配置したとき、同じカード名の自分の導界者ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。";
const printedOracleFixtures = [
  {
    textLines: [
      "【導託：[幻想] [幻想＆アルティメット/ブレイヴ] [賢者＆ネクサス]】",
      "◆対象の自分のスピリット/アルティメット/ブレイヴ/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      printedOraclePlacement,
    ],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        { tribes: ["幻想"], categories: ["spirit"] },
        { tribes: ["幻想"], categories: ["ultimate", "brave"] },
        { tribes: ["賢者"], categories: ["nexus"] },
      ],
    },
  },
  {
    textLines: [
      "【導託：[幻想＆冥主＆コスト5以上]】",
      "◆対象の自分のスピリットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      printedOraclePlacement,
    ],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        {
          tribes: ["幻想", "冥主"],
          tribesLogic: "and",
          minCost: 5,
          categories: ["spirit"],
        },
      ],
    },
  },
  {
    textLines: [
      "【導託：〔幻想＆コスト3以上〕〔転醒ネクサス〕】",
      "◆対象の自分のスピリット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
      printedOraclePlacement,
    ],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        { tribes: ["幻想"], minCost: 3, categories: ["spirit", "nexus"] },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
    },
  },
  {
    textLines: [
      "【真・導託：〔動玩/四道/導魔＆コスト3以上〕〔転醒ネクサス〕】",
      "◆ 対象の自分のスピリット/ネクサスを召喚/配置したとき、このネクサスにコア+1できる。",
      "◆ 〔ターンに1回:同名〕このネクサスを配置したとき、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき、このネクサスにコア+1する。",
    ],
    grandwalkerData: {
      kind: "guided",
      oracleExecutionMode: "optional",
      oracleTriggerKinds: ["summon", "place"],
      oracleConditions: [
        {
          tribes: ["動玩", "四道", "導魔"],
          minCost: 3,
          categories: ["spirit", "nexus"],
        },
        { hasMechanic: ["rebirth"], categories: ["nexus"] },
      ],
      placementOracle: { sameNameGate: false, turnLimit: "per_card_name" },
    },
  },
  {
    textLines: [
      "【導託：〔妖精〕〔妖精＆アルティメット〕】",
      "◆対象の自分のスピリット/アルティメットを召喚/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。",
      "◆このネクサスを配置したとき、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
    ],
    grandwalkerData: {
      kind: "guided",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        { tribes: ["妖精"], categories: ["spirit"] },
        { tribes: ["妖精"], categories: ["ultimate"] },
      ],
      placementOracle: { sameNameGate: false },
    },
  },
  {
    textLines: [
      "【神託：〔面霊／天渡／化神＆コスト3以上〕〔ブレイヴ＆【アクセル】を持つ〕】",
      "◆対象の自分のスピリット/ブレイヴの召喚/煌臨/【アクセル】の使用をしたとき、ボイドからコア1個をこのネクサスに置ける。",
      printedOraclePlacement.replace("導界者", "創界神"),
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent", "use_accel"],
      oracleConditions: [
        {
          tribes: ["面霊", "天渡", "化神"],
          minCost: 3,
          categories: ["spirit"],
        },
        { categories: ["brave"], hasMechanic: ["accel"] },
      ],
    },
  },
];
const stackMagicOracle = {
  cardNo: "TEST-STACK-MAGIC-ORACLE",
  textLines: [
    "【神託：〔依神＆ネクサス〕〔スタック効果＆マジック〕】",
    "◆対象の自分のネクサス/マジックを配置/使用したとき、ボイドからコア1個をこのネクサスに置ける。",
    "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。",
  ],
  grandwalkerData: {
    kind: "grandwalker",
    oracleConditions: [
      { tribes: ["依神"], categories: ["nexus"] },
      { categories: ["magic"], hasMechanic: ["stack_effect"] },
    ],
    oracleTriggerKinds: ["place", "use_magic"],
  },
};
printedOracleFixtures.push(stackMagicOracle);
for (const [index, face] of printedOracleFixtures.entries()) {
  for (const line of face.textLines)
    assert.equal(
      hasExactPrintedOracleCarrier(face, line),
      true,
      `printed profile ${index}`
    );
  for (const [label, mutate] of [
    [
      "extra event",
      (f) => f.grandwalkerData.oracleTriggerKinds.push("use_magic"),
    ],
    [
      "implicit unrestricted events",
      (f) => delete f.grandwalkerData.oracleTriggerKinds,
    ],
    ["missing condition", (f) => f.grandwalkerData.oracleConditions.pop()],
    [
      "wrong tribe",
      (f) => (f.grandwalkerData.oracleConditions[0].tribes = ["異系統"]),
    ],
    [
      "wrong category",
      (f) => (f.grandwalkerData.oracleConditions[0].categories = ["magic"]),
    ],
    ["wrong cost", (f) => (f.grandwalkerData.oracleConditions[0].minCost = 1)],
    [
      "unprinted color",
      (f) => (f.grandwalkerData.oracleConditions[0].colors = ["blue"]),
    ],
    [
      "unprinted color count",
      (f) => (f.grandwalkerData.oracleConditions[0].colorCount = 1),
    ],
    [
      "unprinted tribal restriction",
      (f) =>
        (f.grandwalkerData.oracleConditions[0].tribesRequired = ["異系統"]),
    ],
    ["mandatory", (f) => (f.grandwalkerData.oracleExecutionMode = "mandatory")],
    [
      "unprinted step limit",
      (f) => (f.grandwalkerData.oracleTriggerLimit = "step_once"),
    ],
    [
      "four deck cards",
      (f) =>
        (f.grandwalkerData.placementOracle = {
          ...f.grandwalkerData.placementOracle,
          revealCount: 4,
        }),
    ],
    [
      "wrong destination",
      (f) =>
        (f.grandwalkerData.placementOracle = {
          ...f.grandwalkerData.placementOracle,
          remainderDest: "bottom",
        }),
    ],
    ["disabled placement", (f) => (f.grandwalkerData.placementOracle = false)],
    [
      "unprinted return",
      (f) =>
        (f.grandwalkerData.placementOracleReturnToHand = {
          cardName: "追加回収",
        }),
    ],
    [
      "duplicate effect",
      (f) =>
        (f.effects = [
          {
            textRef: [1],
            timing: { kind: "card_event" },
            steps: [{ action: { kind: "noop" } }],
          },
        ]),
    ],
  ]) {
    const broken = JSON.parse(JSON.stringify(face));
    mutate(broken);
    assert.equal(
      hasExactPrintedOracleCarrier(broken, broken.textLines[1]),
      false,
      `${index}: ${label}`
    );
  }
}
for (const mechanics of [undefined, ["accel"], ["stack_effect", "accel"]]) {
  const broken = JSON.parse(JSON.stringify(stackMagicOracle));
  broken.grandwalkerData.oracleConditions[1].hasMechanic = mechanics;
  assert.equal(
    hasExactPrintedOracleCarrier(broken, broken.textLines[1]),
    false
  );
}
const blueMagicDomain = {
  cardNo: "TEST-BLUE-MAGIC-DOMAIN",
  textLines: [
    "【導域】Lv1-Lv2",
    "自分の青のマジックカードの使用コストは、このネクサスからボイドに支払うこともできる。",
    "【導域】Lv2",
    "自分の青のマジックカードのスタック効果が発揮されたとき、相手のデッキを上から4枚破棄し、ボイドからコア1個をこのネクサスに置く。",
  ],
  levelDefs: [{ level: 1 }, { level: 2 }],
  grandwalkerData: {
    kind: "grandwalker",
    domainHooks: ["blue_magic_void_payment", "blue_magic_stack_domain"],
  },
};
for (const line of blueMagicDomain.textLines)
  assert.equal(hasExactBlueMagicDomainCarrier(blueMagicDomain, line), true);
const domainTestRef = "packages/rules-core/test/test-blue-domain.test.ts";
const domainTestName =
  "TEST-BLUE-MAGIC-DOMAIN printed_blue_magic_domain: 最終盤面";
const domainAccounts = Object.fromEntries(
  blueMagicDomain.textLines.map((_, index) => [
    `TEST-BLUE-MAGIC-DOMAIN:textLines[${index}]`,
    {
      kind: "structured_carrier",
      carrierPath: "grandwalkerData.domainHooks",
      behavior: "printed_blue_magic_domain",
      testRefs: [domainTestRef],
      testEvidence: { testRef: domainTestRef, testName: domainTestName },
      reason: "印字の固定hookと盤面を照合",
    },
  ])
);
const domainLedger = (face) =>
  buildTextAccountabilityLedger({
    cards: [face],
    overrides: { accounts: domainAccounts },
    testFileContents: new Map([
      [domainTestRef, `it(${JSON.stringify(domainTestName)}, () => {});`],
    ]),
    discoveredTestTitles: new Map([[domainTestRef, new Set([domainTestName])]]),
  });
assert.equal(
  domainLedger(blueMagicDomain).entries.every(
    (entry) => entry.status === "carrier_contract"
  ),
  true
);
const reorderedDomainBlocks = JSON.parse(JSON.stringify(blueMagicDomain));
reorderedDomainBlocks.textLines = [2, 3, 0, 1].map(
  (index) => blueMagicDomain.textLines[index]
);
for (const line of reorderedDomainBlocks.textLines)
  assert.equal(
    hasExactBlueMagicDomainCarrier(reorderedDomainBlocks, line),
    true
  );
assert.equal(domainLedger(reorderedDomainBlocks).gate.clean, true);
for (const [label, mutate] of [
  ["no payment hook", (f) => f.grandwalkerData.domainHooks.shift()],
  ["no stack hook", (f) => f.grandwalkerData.domainHooks.pop()],
  [
    "duplicate hook",
    (f) =>
      (f.grandwalkerData.domainHooks[1] = f.grandwalkerData.domainHooks[0]),
  ],
  ["extra hook", (f) => f.grandwalkerData.domainHooks.push("extra")],
  [
    "wrong destination",
    (f) => (f.textLines[1] = f.textLines[1].replace("ボイド", "トラッシュ")),
  ],
  ["wrong color", (f) => (f.textLines[3] = f.textLines[3].replace("青", "赤"))],
  [
    "wrong count",
    (f) => (f.textLines[3] = f.textLines[3].replace("4枚", "5枚")),
  ],
  [
    "optional",
    (f) => (f.textLines[3] = f.textLines[3].replace("置く。", "置ける。")),
  ],
  ["wrong level", (f) => (f.textLines[2] = "【導域】Lv1")],
  [
    "swapped level headers",
    (f) =>
      ([f.textLines[0], f.textLines[2]] = [f.textLines[2], f.textLines[0]]),
  ],
  [
    "swapped domain bodies",
    (f) =>
      ([f.textLines[1], f.textLines[3]] = [f.textLines[3], f.textLines[1]]),
  ],
  ["intervening level header", (f) => f.textLines.splice(1, 0, "【導域】Lv1")],
  ["extra level", (f) => f.levelDefs.push({ level: 3 })],
  ["duplicate level", (f) => (f.levelDefs[1].level = 1)],
  ["duplicate body", (f) => f.textLines.push(f.textLines[3])],
  [
    "duplicate effect",
    (f) =>
      (f.effects = [
        { textRef: [3], timing: { kind: "continuous" }, steps: [] },
      ]),
  ],
]) {
  const broken = JSON.parse(JSON.stringify(blueMagicDomain));
  mutate(broken);
  assert.equal(
    hasExactBlueMagicDomainCarrier(broken, broken.textLines[0]),
    false,
    label
  );
  assert.equal(
    domainLedger(broken).gate.clean,
    false,
    `${label}: ledger must fail closed`
  );
}
const wrongAnd = JSON.parse(JSON.stringify(printedOracleFixtures[1]));
wrongAnd.grandwalkerData.oracleConditions[0].tribesLogic = "or";
assert.equal(
  hasExactPrintedOracleCarrier(wrongAnd, wrongAnd.textLines[1]),
  false
);
const wrongRebirth = JSON.parse(JSON.stringify(printedOracleFixtures[2]));
delete wrongRebirth.grandwalkerData.oracleConditions[1].hasMechanic;
assert.equal(
  hasExactPrintedOracleCarrier(wrongRebirth, wrongRebirth.textLines[1]),
  false
);
const wrongNameScope = JSON.parse(JSON.stringify(printedOracleFixtures[3]));
wrongNameScope.grandwalkerData.placementOracle.sameNameGate = true;
assert.equal(
  hasExactPrintedOracleCarrier(wrongNameScope, wrongNameScope.textLines[2]),
  false
);
const unprintedNameGate = JSON.parse(JSON.stringify(printedOracleFixtures[4]));
unprintedNameGate.grandwalkerData.placementOracle.sameNameGate = true;
assert.equal(
  hasExactPrintedOracleCarrier(
    unprintedNameGate,
    unprintedNameGate.textLines[2]
  ),
  false
);
const unprintedNameLimit = JSON.parse(JSON.stringify(printedOracleFixtures[4]));
unprintedNameLimit.grandwalkerData.placementOracle.turnLimit = "per_card_name";
assert.equal(
  hasExactPrintedOracleCarrier(
    unprintedNameLimit,
    unprintedNameLimit.textLines[2]
  ),
  false
);
const missingAccel = JSON.parse(JSON.stringify(printedOracleFixtures[5]));
delete missingAccel.grandwalkerData.oracleConditions[1].hasMechanic;
assert.equal(
  hasExactPrintedOracleCarrier(missingAccel, missingAccel.textLines[1]),
  false
);
const missingAccelEvent = JSON.parse(JSON.stringify(printedOracleFixtures[5]));
missingAccelEvent.grandwalkerData.oracleTriggerKinds.pop();
assert.equal(
  hasExactPrintedOracleCarrier(
    missingAccelEvent,
    missingAccelEvent.textLines[1]
  ),
  false
);
const colorOracleFixtures = [
  {
    textLines: [
      "【神託：〔黒1色〕〔黒1色＆アルティメット/ネクサス〕】",
      "◆対象の自分のスピリット/アルティメット/ネクサスを召喚/煌臨/配置したとき、このネクサスにコア+1できる。",
      printedOraclePlacement.replace("導界者", "創界神"),
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent", "place"],
      oracleConditions: [
        {
          colors: ["black"],
          colorCount: "mono",
          categories: ["spirit", "ultimate", "nexus"],
        },
      ],
    },
  },
  {
    textLines: [
      "【神託：〔月人＆アルティメット〕〔黒1色＆スピリット/アルティメット〕】",
      "◆対象の自分のスピリット/アルティメットを召喚/煌臨したとき、このネクサスにコア+1できる。",
      printedOraclePlacement.replace("導界者", "創界神"),
    ],
    grandwalkerData: {
      kind: "grandwalker",
      oracleTriggerKinds: ["summon", "advent"],
      oracleConditions: [
        { tribes: ["月人"], categories: ["ultimate"] },
        {
          colors: ["black"],
          colorCount: "mono",
          categories: ["spirit", "ultimate"],
        },
      ],
    },
  },
];
for (const [index, face] of colorOracleFixtures.entries()) {
  for (const line of face.textLines)
    assert.equal(
      hasExactPrintedOracleCarrier(face, line),
      true,
      `color oracle ${index}`
    );
  for (const [label, mutate] of [
    ["missing color", (c) => delete c.colors],
    ["wrong color", (c) => (c.colors = ["red"])],
    ["extra color", (c) => c.colors.push("red")],
    ["missing mono", (c) => delete c.colorCount],
    ["multi color", (c) => (c.colorCount = "multi")],
    ["wider category", (c) => c.categories.push("magic")],
    ["duplicate category", (c) => c.categories.push(c.categories[0])],
    ["unprinted tribe", (c) => (c.tribes = ["月人"])],
    ["unprinted cost", (c) => (c.minCost = 3)],
    ["unprinted mechanic", (c) => (c.hasMechanic = ["rebirth"])],
    ["unknown filter", (c) => (c.tribesRequired = ["幻想"])],
  ]) {
    const broken = JSON.parse(JSON.stringify(face));
    mutate(broken.grandwalkerData.oracleConditions.at(-1));
    for (const line of broken.textLines)
      assert.equal(
        hasExactPrintedOracleCarrier(broken, line),
        false,
        `${index}: ${label}`
      );
  }
  for (const [label, mutate] of [
    ["extra event", (d) => d.oracleTriggerKinds.push("use_magic")],
    ["missing event", (d) => d.oracleTriggerKinds.pop()],
    ["duplicate event", (d) => d.oracleTriggerKinds.push("summon")],
    ["mandatory", (d) => (d.oracleExecutionMode = "mandatory")],
    ["unprinted usage limit", (d) => (d.oracleTriggerLimit = "step_once")],
    ["disabled placement", (d) => (d.placementOracle = false)],
    ["wrong placement count", (d) => (d.placementOracle = { revealCount: 4 })],
    ["missing name gate", (d) => (d.placementOracle = { sameNameGate: false })],
    [
      "wrong placement destination",
      (d) => (d.placementOracle = { remainderDest: "hand" }),
    ],
  ]) {
    const broken = JSON.parse(JSON.stringify(face));
    mutate(broken.grandwalkerData);
    assert.equal(
      hasExactPrintedOracleCarrier(broken, broken.textLines[1]),
      false,
      `${index}: ${label}`
    );
  }
}
const splitBlackOracle = JSON.parse(JSON.stringify(colorOracleFixtures[0]));
splitBlackOracle.grandwalkerData.oracleConditions = [
  { colors: ["black"], colorCount: "mono", categories: ["spirit"] },
  { colors: ["black"], colorCount: "mono", categories: ["ultimate", "nexus"] },
];
assert.equal(
  hasExactPrintedOracleCarrier(splitBlackOracle, splitBlackOracle.textLines[1]),
  true
);
for (const mutate of [
  (d) => delete d.oracleConditions[0].tribes,
  (d) => (d.oracleConditions[0].categories = ["spirit", "ultimate"]),
  (d) => (d.oracleConditions[0].colors = ["black"]),
  // Combining the color and tribal restrictions into one AND is not the printed OR.
  (d) =>
    (d.oracleConditions = [
      {
        tribes: ["月人"],
        colors: ["black"],
        colorCount: "mono",
        categories: ["spirit", "ultimate"],
      },
    ]),
]) {
  const broken = JSON.parse(JSON.stringify(colorOracleFixtures[1]));
  mutate(broken.grandwalkerData);
  assert.equal(
    hasExactPrintedOracleCarrier(broken, broken.textLines[1]),
    false
  );
}
const noContractEntry = {
  cardNo: "BSTH10-C01",
  printedCategory: "ultimate",
  textLines: ["【召喚条件：自分が契約していない】"],
  summonCondition: [{ kind: "no_contract_card", player: "self" }],
};
const noContractGenkaiEntry = {
  ...noContractEntry,
  cardNo: "BSTH10-X05",
  textLines: ["【召喚／現界条件：自分が契約していない】"],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      applicability: { zone: "hand" },
      condition: [{ kind: "no_contract_card", player: "self" }],
      steps: [
        {
          action: {
            kind: "put",
            effectScope: "genkai",
            target: { kind: "self" },
          },
        },
      ],
    },
  ],
};
for (const face of [noContractEntry, noContractGenkaiEntry]) {
  assert.equal(hasExactNoContractEntryCarrier(face, face.textLines[0]), true);
  const ledger = buildTextAccountabilityLedger({
    cards: [face],
    testFileContents: testFiles,
    discoveredTestTitles,
  });
  assert.equal(ledger.entries[0].source, "structured_carrier");
  for (const mutate of [
    (c) => delete c.summonCondition,
    (c) => (c.summonCondition = []),
    (c) => (c.summonCondition[0].negate = true),
    (c) => (c.summonCondition[0].kind = "no_presented_contract_card"),
    (c) => (c.summonCondition[0].player = "opponent"),
    (c) => (c.summonCondition[0].unknownConstraint = true),
    (c) => c.summonCondition.push({ kind: "life_count", max: 3 }),
  ]) {
    const broken = globalThis.structuredClone(face);
    mutate(broken);
    assert.equal(
      hasExactNoContractEntryCarrier(broken, broken.textLines[0]),
      false
    );
    assert.equal(
      buildTextAccountabilityLedger({
        cards: [broken],
        testFileContents: testFiles,
        discoveredTestTitles,
      }).entries[0].source,
      "unclaimed"
    );
  }
}
for (const mutate of [
  (c) => delete c.effects,
  (c) => delete c.effects[0].condition,
  (c) => (c.effects[0].condition[0].negate = true),
  (c) => (c.effects[0].condition[0].kind = "no_presented_contract_card"),
  (c) => (c.effects[0].condition[0].player = "opponent"),
  (c) => (c.effects[0].applicability.zone = "trash"),
  (c) => (c.effects[0].steps[0].action.kind = "summon"),
  (c) => (c.effects[0].steps[0].action.target.kind = "filter"),
  (c) =>
    c.effects.push({
      ...globalThis.structuredClone(c.effects[0]),
      condition: [],
    }),
]) {
  const broken = globalThis.structuredClone(noContractGenkaiEntry);
  mutate(broken);
  assert.equal(
    hasExactNoContractEntryCarrier(broken, broken.textLines[0]),
    false
  );
}
const implicitSelfEntry = globalThis.structuredClone(noContractEntry);
delete implicitSelfEntry.summonCondition[0].player;
assert.equal(
  hasExactNoContractEntryCarrier(
    implicitSelfEntry,
    implicitSelfEntry.textLines[0]
  ),
  true
);
assert.equal(
  hasExactNoContractEntryCarrier(
    noContractEntry,
    "【召喚条件：自分が契約している】"
  ),
  false
);
const manifestFace = {
  cardNo: "TEST-MANIFEST",
  printedCategory: "spirit",
  textLines: [
    "フラッシュ【顕現：「アリス」&導界者ネクサス&C2以上『自分のメインステップ』】",
    "自分の《ソウルコア》をトラッシュに置くことで、対象から1コスト支払って手札から召喚する。",
  ],
  manifestData: {
    targetFilter: {
      category: ["nexus"],
      targetsGrandwalker: true,
      hasMechanic: ["guided"],
      cardName: { contains: "アリス" },
    },
    condition: [{ kind: "count_value", player: "self", min: 2 }],
    manifestTiming: "own_main_step",
    soulCoreDest: "trash",
  },
  effects: [],
};
for (const line of manifestFace.textLines) {
  assert.equal(hasExactManifestCarrier(manifestFace, line), true);
}
const manifestLedger = (face) =>
  buildTextAccountabilityLedger({
    cards: [face],
    testFileContents: testFiles,
    discoveredTestTitles,
  });
assert.deepEqual(
  manifestLedger(manifestFace).entries.map((entry) => entry.source),
  ["structured_carrier", "structured_carrier"]
);
assert.equal(
  buildTextAccountabilityLedger({ cards: [manifestFace] }).entries[0].status,
  "invalid_carrier"
);
for (const mutate of [
  (face) => delete face.manifestData,
  (face) => delete face.manifestData.condition,
  (face) => {
    delete face.manifestData.condition;
    face.manifestData.targetFilter.minCores = 2;
  },
  (face) => {
    face.manifestData.targetFilter.minCores = 2;
  },
  (face) => {
    face.manifestData.condition[0].min = 3;
  },
  (face) => {
    face.manifestData.condition[0].player = "opponent";
  },
  (face) => {
    face.manifestData.condition[0].max = 4;
  },
  (face) => {
    face.manifestData.condition.push({ kind: "field_has", minCount: 2 });
  },
  (face) => {
    face.manifestData.targetFilter.cardName.contains = "霊夢";
  },
  (face) => {
    face.manifestData.targetFilter.hasMechanic = ["grandwalker"];
  },
  (face) => {
    delete face.manifestData.targetFilter.targetsGrandwalker;
  },
  (face) => {
    face.manifestData.manifestTiming = "own_turn";
  },
  (face) => {
    face.manifestData.soulCoreDest = "this_card";
  },
  (face) => {
    face.textLines[1] = face.textLines[1].replace("1コスト", "2コスト");
  },
  (face) => {
    face.textLines[0] = face.textLines[0].replace(
      "自分のメイン",
      "お互いのアタック"
    );
  },
]) {
  const broken = JSON.parse(JSON.stringify(manifestFace));
  mutate(broken);
  for (const line of broken.textLines)
    assert.equal(hasExactManifestCarrier(broken, line), false);
  assert.deepEqual(
    manifestLedger(broken).entries.map((entry) => entry.source),
    ["unclaimed", "unclaimed"]
  );
}
const identityTestRef =
  "packages/rules-core/test/printed-identity-and-usage-carrier.test.ts";
const identityTestTitles = [
  "BSTH03-X04 ultimate-added-tribe-all-zones: 起幻の手札破棄・トラッシュ回収と場の参照を確認",
  "BSTH03-R03/BSTH06-R01 card-attack-step-use-restriction: 両ターンのフラッシュ/スタック完走と他ステップ不発",
];
testFiles.set(
  identityTestRef,
  identityTestTitles
    .map((title) => `it(${JSON.stringify(title)}, () => {});`)
    .join("\n")
);
discoveredTestTitles.set(identityTestRef, new Set(identityTestTitles));
const identityLedger = (face) =>
  buildTextAccountabilityLedger({
    cards: [face],
    testFileContents: testFiles,
    discoveredTestTitles,
  });
const ultimateIdentity = {
  cardNo: "TEST-ADDED-ULTIMATE-TRIBE",
  printedCategory: "ultimate",
  tribe: "幻想・空牙・起幻",
  textLines: ["このカード／アルティメットは、系統：「起幻」を持つ。"],
  effects: [],
};
assert.equal(
  identityLedger(ultimateIdentity).entries[0].source,
  "structured_carrier"
);
for (const change of [
  { tribe: "幻想・空牙" },
  { printedCategory: "spirit" },
  {
    textLines: [
      "フィールドにあるこのカード／アルティメットは、系統：「起幻」を持つ。",
    ],
  },
  {
    textLines: [
      "このカード／アルティメットは、系統：「起幻」を持つ。その後、1枚ドローする。",
    ],
  },
]) {
  assert.equal(
    identityLedger({ ...ultimateIdentity, ...change }).entries[0].source,
    "unclaimed"
  );
}
const attackUsage = {
  cardNo: "TEST-CARD-ATTACK-USAGE",
  printedCategory: "magic",
  textLines: [
    "このカードは、『お互いのアタックステップ』にしか使えない。",
    "2体を疲労させる。",
    "1体を疲労させる。",
  ],
  effects: [
    { timing: { kind: "continuous" }, steps: [], textRef: [0] },
    ...["flash", "stack"].map((mode, index) => ({
      timing: { kind: "activated", mode },
      timingScope: { player: "both", period: "attack" },
      steps: [{ action: { kind: "exhaust", target: { kind: "self" } } }],
      textRef: [index + 1],
    })),
  ],
};
assert.equal(identityLedger(attackUsage).entries[0].source, "effects.textRef");
assert.ok(
  !collectCoverageFindings([attackUsage]).some(
    (issue) => issue.kind === "empty_effect_steps"
  )
);
for (const mutate of [
  (face) => {
    delete face.effects[1].timingScope;
  },
  (face) => {
    delete face.effects[2].timingScope;
  },
  (face) => {
    face.effects[1].timingScope.player = "self";
  },
  (face) => {
    face.effects[2].timingScope.period = "main";
  },
  (face) => {
    face.effects[2].timingScope.subPhase = "end";
  },
  (face) => {
    face.effects[1].timing.mode = "main";
  },
  (face) => {
    face.effects[2].stub = true;
  },
  (face) => {
    face.effects[1].steps = [];
  },
  (face) => {
    face.effects = [face.effects[0]];
  },
]) {
  const broken = JSON.parse(JSON.stringify(attackUsage));
  mutate(broken);
  assert.equal(
    identityLedger(broken).entries[0].source,
    "effects.textRef",
    "textRef alone must not receive timing carrier credit"
  );
  assert.ok(
    collectCoverageFindings([broken]).some(
      (issue) => issue.kind === "empty_effect_steps"
    )
  );
}
const independentNormalOracle = {
  textLines: [
    "【神託：〔竜渡／博麗／賢者／幻想＆アルティメット〕〔導界者ネクサス〕】",
    "◆対象の自分のアルティメット/ネクサスを召喚/煌臨/配置したとき、ボイドからコア1個をこのネクサスに置ける。",
    "◆このネクサスを配置したとき、同じカード名の自分の創界神ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中のカード1枚につきボイドからコア1個をこのネクサスに置く。",
  ],
  grandwalkerData: {
    kind: "grandwalker",
    alsoCountsAs: "guided",
    oracleTriggerKinds: ["summon", "advent", "place"],
    oracleConditions: [
      { tribes: ["竜渡", "博麗", "賢者", "幻想"], categories: ["ultimate"] },
      { categories: ["nexus"], hasMechanic: ["guided"] },
    ],
    placementOracle: false,
  },
};
const normalOnly = { normalOnly: true };
assert.equal(
  hasExactPrintedOracleCarrier(
    independentNormalOracle,
    independentNormalOracle.textLines[1],
    normalOnly
  ),
  true,
  "independent normal oracle accepts its exact printed OR branches"
);
assert.equal(
  hasExactPrintedOracleCarrier(
    independentNormalOracle,
    independentNormalOracle.textLines[2],
    normalOnly
  ),
  false,
  "normal oracle cannot account for an independent placement body"
);
assert.equal(
  hasExactPrintedOracleCarrier(
    independentNormalOracle,
    independentNormalOracle.textLines[1]
  ),
  false,
  "the all-card placement variant still requires its own exact contract"
);
for (const [label, mutate] of [
  [
    "extra event",
    (f) => f.grandwalkerData.oracleTriggerKinds.push("use_magic"),
  ],
  ["missing event", (f) => f.grandwalkerData.oracleTriggerKinds.pop()],
  ["implicit events", (f) => delete f.grandwalkerData.oracleTriggerKinds],
  [
    "duplicate event",
    (f) => f.grandwalkerData.oracleTriggerKinds.push("summon"),
  ],
  [
    "wrong category",
    (f) => f.grandwalkerData.oracleConditions[0].categories.push("spirit"),
  ],
  ["missing tribe", (f) => f.grandwalkerData.oracleConditions[0].tribes.pop()],
  [
    "wrong mechanic",
    (f) =>
      (f.grandwalkerData.oracleConditions[1].hasMechanic = ["grandwalker"]),
  ],
  [
    "implicit nexus",
    (f) => delete f.grandwalkerData.oracleConditions[1].categories,
  ],
  ["mandatory", (f) => (f.grandwalkerData.oracleExecutionMode = "mandatory")],
  [
    "unprinted limit",
    (f) => (f.grandwalkerData.oracleTriggerLimit = "step_once"),
  ],
  [
    "duplicate body effect",
    (f) =>
      (f.effects = [{ textRef: [1], steps: [{ action: { kind: "noop" } }] }]),
  ],
]) {
  const broken = JSON.parse(JSON.stringify(independentNormalOracle));
  mutate(broken);
  assert.equal(
    hasExactPrintedOracleCarrier(broken, broken.textLines[1], normalOnly),
    false,
    `independent normal oracle rejects ${label}`
  );
}
const singleTribeOracle = {
  textLines: [
    "【神託：天璋】",
    "◆対象の自分のスピリットを召喚/煌臨したとき、このネクサスにコア+1できる。",
  ],
  grandwalkerData: {
    kind: "grandwalker",
    oracleTriggerKinds: ["summon", "advent"],
    oracleConditions: [{ tribes: ["天璋"], categories: ["spirit"] }],
    placementOracle: false,
  },
};
assert.equal(
  hasExactPrintedOracleCarrier(
    singleTribeOracle,
    singleTribeOracle.textLines[1],
    normalOnly
  ),
  true,
  "unbracketed single tribe header is also an exact normal oracle"
);
console.log("[test-card-text-accountability-audit] ok");
