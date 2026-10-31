import {
  cardCategoryLabel,
  stepDisplayLabel,
  zoneDisplayLabel,
} from "@orica/rules-core";
import {
  getEffectSourceDisplay,
  getResolutionSourceDisplay,
} from "../utils/effect-source-display";
/**
 * EffectQueueOverlay — 効果解決キュー
 *
 * GameState の解決待ち効果をフィールド中央に MTG Arena 風に
 * カード画像を重ねて表示するオーバーレイコンポーネント。
 *
 * 表示対象:
 *   - battleImmediateEffects[]  (アタック時/ブロック時等)
 *   - pendingPrivateDeclarations[] (非公開ゾーン誘発の宣言待ち)
 *   - pendingBurstChecks[] (発動可否の宣言待ち。viewer legal action があるもの)
 *   - pendingTriggeredEffects[] (誘発効果)
 *   - stackWindow       (メインステップスタック窓)
 *   - preDeclarationStackWindow (宣言前スタック窓)
 *
 * 除外:
 *   - battleResolutionGroup (効果ではない)
 */

import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { CardDetailModal } from "./CardDetailModal";
import {
  EffectQueueListDialog,
  handleEffectDialogKeyDown,
} from "./EffectQueueListDialog";
import { useLongPress } from "../hooks/useLongPress";
import type {
  GameState,
  CardDefinition,
  CardInstance,
  BattleImmediateEffect,
  BattleFlashWindowState,
  PendingPrivateDeclaration,
  PendingBurstCheck,
  PendingTriggeredEffect,
  StackWindow,
  PreDeclarationStackWindow,
  TriggeredEffectActionRegistrationLookup,
  ResolutionItem,
  LegalAction,
  TriggerEventKind,
  ActiveStack,
} from "@orica/rules-core";
import {
  buildResolutionItems,
  burstEventKindToStructuredEvent,
  deriveTriggerPhrasesFromTextRefs,
  generateBattleImmediateEffectRegistrations,
  generateBurstRegistrations,
  generateFieldCardEffectRegistrations,
  isSoulStateCard,
  isAdventSourceUnderCard,
  getEffectiveCategory,
} from "@orica/rules-core";
import { getGrantedEffectDisplayInfoByCeId } from "../utils/granted-effect-display";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EffectQueueItemKind =
  | "battle_immediate"
  | "private_declaration"
  | "burst_check"
  | "triggered"
  | "stack_battle_flash"
  | "stack"
  | "stack_pre_declaration";

export interface EffectQueueItem {
  id: string;
  kind: EffectQueueItemKind;
  /** カード定義 ID（詳細モーダル表示用。imagePath/cardName と同じ def を指す） */
  definitionId: string;
  /** カード画像パス（`/` プレフィックス付き） */
  imagePath: string | null;
  /** カード名 */
  cardName: string;
  /** 効果テキスト */
  effectText: string;
  /** acting player */
  actingPlayerId: string;
  /** タイミングラベル（例: "アタック時", "召喚時"） */
  timingLabel: string;
  /** 同時誘発グループID */
  simultaneousGroupId?: string;
  /**
   * triggered の responder 識別子。
   * 1 つの pending に複数 responder (例: 召喚イベントに対し召喚カード自身の
   * 召喚時効果 + 別ネクサスの「〜が召喚されたとき」が同時誘発) が乗る場合、
   * pendingId だけでは resolve action と 1:1 対応しない。source ごとに 1 カード
   * 展開し、本フィールドで対応 action を特定する。
   */
  sourceInstanceId?: string;
  registrationIndex?: number;
  sourceStateLabel?: string;
  /** 画像・本文と同じ出典個体。盤面の強調に使う。 */
  displaySourceInstanceId?: string;
  /** 元データへの参照 */
  sourceRef:
    | { type: "battleImmediate"; data: BattleImmediateEffect }
    | { type: "privateDeclaration"; data: PendingPrivateDeclaration }
    | { type: "burstCheck"; data: PendingBurstCheck }
    | { type: "triggered"; data: PendingTriggeredEffect }
    | { type: "stackBattleFlash"; data: BattleFlashWindowState }
    | { type: "stack"; data: StackWindow }
    | { type: "stackPreDeclaration"; data: PreDeclarationStackWindow };
  /**
   * P3-86 Phase 3: このキュー項目を「前に進める」legal action 群
   * (発揮する/しない・解決・順序選択など)。`buildEffectQueue` に legal actions を
   * 渡すと各項目に紐づけられる。ActionBar はこのうち「前面項目の actions」
   * だけを注入し、背面項目のボタン漏れを構造的に防ぐ。召喚/使用/パス等の
   * 「新規行動」はどの項目にも属さない (unclaimed = グローバル)。
   */
  actions?: readonly LegalAction[];
}

// ---------------------------------------------------------------------------
// Build queue from GameState
// ---------------------------------------------------------------------------

/** BattleImmediateEffectTiming → 日本語ラベル */
function immediateTimingLabel(timing: string): string {
  switch (timing) {
    case "attack":
      return "アタック時";
    case "block":
      return "ブロック時";
    case "battle":
      return "バトル時";
    case "join":
      return "合体アタック時";
    default:
      return timing;
  }
}

/**
 * TriggerEventKind → 日本語ラベル (card_event 用「〜時」系)。
 *
 * Record<TriggerEventKind, string> で全列挙を強制する。rules-core が
 * TriggerEventKind を追加すると本マップが網羅漏れで tsc エラーになり、
 * 「英語の eventKind が素通しで表示される」退行を機械的に防ぐ
 * (旧 switch は default で raw 文字列を返し、exhaust/advent/battle_end など
 *  多数が英字のまま表示されていた)。
 */
const TRIGGER_EVENT_LABELS: Record<TriggerEventKind, string> = {
  game_start: "ゲーム開始時",
  reduce_life: "ライフ減少時",
  destroy: "破壊時",
  vanish: "消滅時",
  bounce: "バウンス時",
  remove_from_game: "除外時",
  leave_field: "フィールド離脱時",
  summon: "召喚時",
  put: "出た時",
  place: "配置時",
  increase_hand: "手札増加時",
  start_step: "ステップ開始時",
  end_step: "ステップ終了時",
  exhaust: "疲労時",
  recover: "回復時",
  advent: "煌臨時",
  rebirth: "転醒時",
  after_draw: "ドロー後",
  pre_declaration_attack: "アタック宣言時",
  pre_declaration_block: "ブロック宣言時",
  after_cost_paid: "コスト支払い後",
  flash: "フラッシュ使用時",
  card_used: "カード使用後",
  stack: "スタック効果使用時",
  effect_declaration: "効果発揮前",
  targeted: "効果対象時",
  battle_end: "バトル終了時",
  battle_destroy_opponent_only: "バトル相手だけ破壊時",
  count_increase: "カウント増加時",
  count_decrease: "カウント減少時",
  attack: "アタック時",
  attack_declared: "アタック宣言時",
  block: "ブロック時",
  brave_combined: "合体時",
  trash_increase: "トラッシュ増加時",
  core_placed_on_life: "ライフコア配置時",
  text_role_under_card_placed: "アンダーカード配置時",
  void_core_decrease: "ボイドコア減少時",
  enter_soul_state: "魂状態時",
  soul_state_to_spirit_state: "魂状態からスピリット状態になった時",
  quartz_set: "クォーツセット時",
  mirage_set: "ミラージュセット時",
  field_hand_swap: "聖詠入れ替え時",
  soul_drive_activated: "ソウルドライブ・S発動時",
  // P3-92: エンジン機構由来の誘発任意効果 (mechanic 付き pending)
  oracle: "神託コア+1",
  placement_oracle: "配置時神託",
  unseal: "解封コア+1",
  stone_rebirth: "転醒",
  magic_stack_domain: "導域",
  granted_effect: "付与効果",
  effect_activated: "効果発揮時",
  effect_steps_resolved: "効果解決後",
  effect_completed: "効果発揮後",
};

function triggerEventLabel(eventKind: string): string {
  return TRIGGER_EVENT_LABELS[eventKind as TriggerEventKind] ?? "効果発揮時";
}

/**
 * textLines をタイミングヘッダー + 本文のブロックに分割する。
 *
 * ヘッダー判定:
 *   - 『...時』『...ステップ』等を含む行（Lv接頭辞あり/なし）
 *   - 【バースト：...】で始まる行
 *   - Lv で始まり『』を含まない行（常時効果セクション）
 */
interface TextBlock {
  header: string;
  body: string[];
}

function extractMirageSetText(
  def: CardDefinition | undefined,
  matchIndex: number
): string | null {
  const textLines = def?.textLines ?? [];
  const starts = textLines
    .map((line, index) => (/^【ミラージュ[：:]/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const start = starts[Math.min(matchIndex, starts.length - 1)];
  if (start === undefined) return null;

  const collected = [textLines[start]!];
  let index = start + 1;
  while (index < textLines.length) {
    while (textLines[index] === "") index++;
    if (index >= textLines.length) break;
    if (!/^【セット中】/.test(textLines[index]!)) break;
    while (index < textLines.length && textLines[index] !== "") {
      collected.push(textLines[index]!);
      index++;
    }
  }

  return collected.join("\n");
}

function extractQuartzSetText(
  def: CardDefinition | undefined,
  matchIndex: number
): string | null {
  const textLines = def?.textLines ?? [];
  const starts = textLines
    .map((line, index) => (/^【クォーツ[：:]/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const start = starts[Math.min(matchIndex, starts.length - 1)];
  if (start === undefined) return null;

  const collected: string[] = [];
  for (let index = start; index < textLines.length; index++) {
    const line = textLines[index]!;
    if (line === "") break;
    collected.push(line);
  }
  return collected.join("\n");
}

function splitTextBlocks(textLines: string[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  // ヘッダー判定: 『』を含む or キーワードブラケット【…】 or 単独Lv行。
  // god 系 (創界神/導界者/契約者/真・…) の機構・能力は接頭が 神/導/契約/真・… と多様だが
  // 末尾は 託 (神託/導託…=oracle)・技 (神技/導技/契約技…=divine skill)・域 (神域/導域/契約域)
  // で一貫する。よって接頭を限定せず「【…(託|技|域)」を 1 グループで認識する
  // (真・神託 等の未収録カードも自動追従)。バースト/アクセル/アーツ/解封/転醒/…チェンジ は別記。
  // 行頭アンカー (任意でタイミング接頭「フラッシュ」「メイン」) は、本文中に埋め込まれた参照
  // (例:「…、【神託】/【導託】以外の相手の効果を受けない」/「相手の手札の【アクセル】のコスト+3」) を
  // 誤ってヘッダー扱いし、機構ブロック抽出が無関係行を拾う退行を防ぐため。
  // [^】：:]* で : 以降 (条件部) は跨がない。
  // 接頭にタイミングを許すのは、アクセル/チェンジが印字上「メイン【アクセル：…】」
  // 「フラッシュ【アクセル：…】」のようにタイミング語で始まり 【 が行頭に来ないため
  // (メイン版を欠くと extractEffectText("accel") が該当ブロックを見つけられず
  //  カード全文へフォールバックしていた: 小悪魔 BSTH01-R05 等)。
  // ミラージュ/クォーツのセット宣言スタックも同じ keyword 抽出を使うため、
  // 印字機構ヘッダーとして扱う。
  const isHeader = (line: string) =>
    /『.*』/.test(line) ||
    /^(?:フラッシュ|メイン)?【(?:バースト|アクセル|アーツ|ミラージュ|クォーツ|解封|転醒|[^】：:]*(?:託|技|域|チェンジ))/.test(
      line
    ) ||
    /^v?Lv\d/.test(line);

  let current: TextBlock | null = null;
  for (const line of textLines) {
    // 空行は効果ブロック区切り（元データの段落区切りを保持）
    if (line === "") {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (isHeader(line)) {
      if (current) blocks.push(current);
      current = { header: line, body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      // ヘッダー前のテキスト（まれ）
      current = { header: "", body: [line] };
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** timing キーワードから、対応するテキストブロックを検索 */
const TIMING_KEYWORDS: Record<string, string[]> = {
  attack: ["アタック時"],
  block: ["ブロック時"],
  battle: ["バトル時"],
  join: ["合体アタック時"],
  on_summon: ["召喚時"],
  summon: ["召喚時"],
  on_place: ["配置時"],
  place: ["配置時"],
  on_destroy: ["破壊時"],
  destroy: ["破壊時"],
  reduce_life: ["ライフ減少"],
  burst: ["バースト"],
  accel: ["アクセル"],
  change: ["チェンジ"],
  // set_mirage / set_quartz の公開スタックキュー用。各ギミックの印字ブロックを
  // 抜き出し、カード全文 fallback で別能力まで巻き込まないようにする。
  mirage: ["ミラージュ"],
  quartz: ["クォーツ"],
  // 神技=創界神 / 導技=導界者 / 契約技=契約者。真・神技 等は "神技" の部分一致でカバー。
  divine_skill: ["神技", "導技", "契約技", "アーツ"],
  // P3-92 mechanic 由来誘発: 創界神/導界者/創界石に印字された機構ブロックを keyword 抽出する。
  // 神託=創界神 / 導託=導界者 (同義) なので両表記。oracle/placement_oracle はどちらも
  // 【神託／導託：…】ブロック、unseal=【解封：…】、stone_rebirth=【転醒：…】。
  // 真・神託/真・導託 (未収録) は header.includes(kw) で "神託"/"導託" に部分一致しカバー。
  // 契約者にはオラクル機構 (契約託) が存在しないため契約版は不要。
  oracle: ["神託", "導託"],
  placement_oracle: ["神託", "導託"],
  unseal: ["解封"],
  stone_rebirth: ["転醒"],
  magic_stack_domain: ["神域", "導域", "契約域"],
  flash: ["フラッシュ"],
  stack: ["スタック"],
  main: ["メインステップ"],
  start_step: ["スタートステップ"],
  end_step: ["エンドステップ"],
};

/**
 * field_card_effect / magic registration index から、対応する
 * `definition.effects[].textRef` を引いて効果テキストを抽出する。
 *
 * 背景: pendingStackAction.chosenTiming だけだと同一カードに複数の
 * `activated/flash` 効果がある場合 (例: BSTH01-X04 フランドール) に
 * `extractEffectText("flash")` が常に先頭のフラッシュ効果テキストを返してしまう
 * 表示バグがあった (P3-61 GUI bug)。registrationIndex 経由で
 * effects[] の対応エントリを引き、textRef でピンポイント抽出する。
 *
 * registrationIndex の対応は engine の登録生成関数を正源とする。
 * GUI 側で登録条件を再実装すると、choice/occurrence gate 等で番号がずれる。
 */
export function extractEffectTextByRegistrationIndex(
  def: CardDefinition | undefined,
  registrationIndex: number
): string | null {
  if (!def) return null;
  return extractTriggeredEffectTextByEffectIndex(
    def,
    generateFieldCardEffectRegistrations(def)[registrationIndex]?.effectIndex
  );
}

/**
 * triggered registration の effectIndex から `effects[effectIndex].textRef` を引いて
 * 効果テキストをピンポイント抽出する。keyword 抽出では、紅魔館の「〜召喚されたとき」の
 * ように 『見出し』を持たない game_event トリガーが本文全体を誤って拾うため、
 * 効果単位の textRef を最優先する。
 */
function extractTriggeredEffectTextByEffectIndex(
  def: CardDefinition | undefined,
  effectIndex: number | undefined
): string | null {
  if (!def?.effects || effectIndex === undefined) return null;
  const effect = def.effects[effectIndex];
  const textRef = effect?.textRef;
  if (!textRef || textRef.length === 0) return null;
  const textLines = def.textLines ?? [];
  const text = textRef
    .map((i) => textLines[i] ?? "")
    .filter((line) => line.length > 0)
    .join("\n");
  return text.length > 0 ? text : null;
}

function extractBattleImmediateEffectTextByRegistrationIndex(
  def: CardDefinition | undefined,
  registrationIndex: number | undefined
): string | null {
  if (!def || registrationIndex === undefined) return null;
  return extractTriggeredEffectTextByEffectIndex(
    def,
    generateBattleImmediateEffectRegistrations(def)[registrationIndex]
      ?.effectIndex
  );
}

function extractBurstEffectTextByRegistrationIndex(
  def: CardDefinition | undefined,
  registrationIndex: number | undefined
): string | null {
  if (!def || registrationIndex === undefined) return null;
  return extractTriggeredEffectTextByEffectIndex(
    def,
    generateBurstRegistrations(def)[registrationIndex]?.effectIndex
  );
}

/**
 * game_event (= 他カードの行動に反応する responder) のタイミングラベル。
 * card_event (= このカード自身) の「〜時」と区別するため「〜されたとき」系の
 * 受動文言にする。レミリア『召喚時』(card_event) と 紅魔館「召喚されたとき」
 * (game_event) が同一 eventKind=summon でも別ラベルになる。
 * 文言はバトルスピリッツの標準表記に準拠。
 */
const GAME_EVENT_TRIGGER_LABEL: Partial<Record<TriggerEventKind, string>> = {
  summon: "召喚されたとき",
  place: "配置されたとき",
  destroy: "破壊されたとき",
  vanish: "消滅したとき",
  bounce: "手札に戻されたとき",
  leave_field: "フィールドを離れたとき",
  reduce_life: "ライフが減ったとき",
  increase_hand: "手札が増えたとき",
  // P3-14 / F2: 他カードの行動を観測する game_event responder。
  attack: "アタックしたとき",
  block: "ブロックしたとき",
  brave_combined: "合体したとき",
  core_placed_on_life: "ライフにコアが置かれたとき",
  text_role_under_card_placed: "アンダーカードが置かれたとき",
  battle_end: "バトルが終わったとき",
  count_increase: "カウントが増えたとき",
  count_decrease: "カウントが減ったとき",
  enter_soul_state: "魂状態になったとき",
  soul_state_to_spirit_state: "魂状態からスピリット状態になったとき",
  quartz_set: "クォーツがセットされたとき",
  field_hand_swap: "【聖詠】を発揮したとき",
};

const CARD_EVENT_TRIGGER_PHRASE_BY_EVENT: Partial<
  Record<TriggerEventKind, string>
> = {
  summon: "召喚時",
  place: "配置時",
  attack: "アタック時",
  block: "ブロック時",
  advent: "煌臨時",
  rebirth: "転醒時",
  battle_end: "バトル終了時",
};

function printedCardEventTimingLabel(
  eventKind: string,
  triggerPhrases: readonly string[] | undefined,
  cause: string | undefined
): string | null {
  if (eventKind === "brave_combined" && cause === "contract_combine") {
    return "契約合体時";
  }
  const expected =
    CARD_EVENT_TRIGGER_PHRASE_BY_EVENT[eventKind as TriggerEventKind];
  if (expected && triggerPhrases?.includes(expected)) {
    return expected;
  }
  if (eventKind === "battle_end" && triggerPhrases?.includes("バトル終了")) {
    return "バトル終了時";
  }
  return null;
}

/** timing.kind を加味した誘発ラベル。game_event は responder 文言にする。 */
function triggeredTimingLabel(
  eventKind: string,
  timingKind: string | undefined,
  triggerPhrases?: readonly string[],
  cause?: string
): string {
  if (timingKind === "game_event") {
    return (
      GAME_EVENT_TRIGGER_LABEL[eventKind as TriggerEventKind] ??
      triggerEventLabel(eventKind)
    );
  }
  return (
    printedCardEventTimingLabel(eventKind, triggerPhrases, cause) ??
    triggerEventLabel(eventKind)
  );
}

/**
 * カード定義から timing に対応する効果テキストブロックを抽出する。
 * matchIndex で同一timingの何番目のブロックかを指定可能（0始まり）。
 */
function extractEffectText(
  def: CardDefinition | undefined,
  timing: string,
  matchIndex = 0
): string {
  if (!def) return "";
  if (timing === "mirage") {
    const text = extractMirageSetText(def, matchIndex);
    if (text) return text;
  }
  if (timing === "quartz") {
    const text = extractQuartzSetText(def, matchIndex);
    if (text) return text;
  }
  const textLines = def.textLines ?? [];
  const blocks = splitTextBlocks(textLines);
  const kws = TIMING_KEYWORDS[timing] ?? [timing];

  // timing に合致するブロックを収集
  // 複合タイミング対応: 『召喚/アタック時』→ "召喚時" "アタック時" 両方にマッチ
  const headerMatchesKw = (header: string, kw: string): boolean => {
    if (header.includes(kw)) return true;
    if (kw.endsWith("時")) {
      const base = kw.slice(0, -1);
      const m = header.match(/『(.+?)時』/);
      if (m) {
        const parts = m[1]!.split("/");
        return parts.some((p) => p.endsWith(base));
      }
    }
    return false;
  };
  const matched = blocks.filter((b) =>
    kws.some((kw) => headerMatchesKw(b.header, kw))
  );

  if (matched.length > 0) {
    const block = matched[Math.min(matchIndex, matched.length - 1)]!;
    // ヘッダー + 本文を連結
    const header = block.header.trim();
    const lines = header ? [header, ...block.body] : block.body;
    return lines.join("\n");
  }

  // マッチしなかったらフォールバック: ヘッダーなしでテキスト全体
  return textLines.join("\n");
}

/** textRef のインデックス集合から textLines を引いて連結する (重複排除・昇順)。 */
function joinTextRef(
  def: CardDefinition | undefined,
  indices: readonly number[]
): string {
  if (!def) return "";
  const lines = def.textLines ?? [];
  return [...new Set(indices)]
    .sort((a, b) => a - b)
    .map((i) => lines[i] ?? "")
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * マジックの効果テキストを chosenTiming (main/flash/stack) に一致する activated 効果の
 * textRef からピンポイント抽出する。複数効果マジック (フラッシュ/メイン両持ち・分岐) で
 * キーワード抽出が誤ブロックやカード全文を返す問題を避ける。一致 effect が無い
 * (continuous stub 等) 場合は null を返し、呼び出し側の従来フォールバックに委ねる。
 */
function magicEffectText(
  def: CardDefinition | undefined,
  chosenTiming: "main" | "flash" | "stack" | undefined,
  magicEffectIndex: number | undefined
): string | null {
  const indexedText = extractTriggeredEffectTextByEffectIndex(
    def,
    magicEffectIndex
  );
  if (indexedText) return indexedText;
  if (!def?.effects) return null;
  const filter = chosenTiming ?? "flash";
  const indices = def.effects
    .filter((e) => e.timing.kind === "activated" && e.timing.mode === filter)
    .flatMap((e) => e.textRef ?? []);
  if (indices.length === 0) return null;
  const text = joinTextRef(def, indices);
  return text.length > 0 ? text : null;
}

/**
 * pendingStackAction から効果テキストを引く。
 *
 * actionKind ごとに「実際にスタックに乗っている効果」を指す表示を返す:
 *   - 召喚/配置: 空欄 (宣言そのものでカード全体動作。「召喚時」等は別キューカード)
 *   - field/hand/triggered: 登録 index → effects[].textRef でピンポイント
 *   - mechanic 由来 (神託/解封/転醒): triggered_effect の textRef 不在後、stackActionTiming が
 *     eventKind=mechanic kind を返し TIMING_KEYWORDS で印字機構ブロックを keyword 抽出する
 *   - magic: chosenTiming 一致 activated 効果の textRef
 *   - battle_immediate/burst: 宣言前キューと同じ登録正源 → textRef
 *   - accel/change/divine: 各機構の effects[].textRef
 * いずれも解決できないときのみ従来の keyword 抽出 (最終的にカード全文) にフォールバック。
 */
function stackActionEffectText(
  def: CardDefinition | undefined,
  action: ActiveStack,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup
): string {
  // 召喚/配置はカード全体の動作で、スタックに乗るのは「召喚/配置の宣言」そのもの。
  // 「召喚時」等の効果は解決後に別の誘発キューカードとして改めて出るため、ここで
  // 特定タイミングのブロックを抜き出すと中途半端かつ重複表示になる。効果テキストは
  // 空欄にし、ラベル (「召喚・応答待ち」) のみで示す。空欄でもカード高さは CSS
  // (.effect-queue-description.is-blank) で維持し、テキスト有りカードと一貫させる。
  if (action.actionKind === "summon" || action.actionKind === "place_nexus") {
    return "";
  }
  if (
    action.actionKind === "field_card_effect" &&
    (action.fieldEffectIndex !== undefined ||
      action.fieldEffectRegistrationIndex !== undefined)
  ) {
    const text =
      extractTriggeredEffectTextByEffectIndex(def, action.fieldEffectIndex) ??
      (action.fieldEffectRegistrationIndex !== undefined
        ? extractEffectTextByRegistrationIndex(
            def,
            action.fieldEffectRegistrationIndex
          )
        : null);
    if (text) return text;
  }
  // 手札起動効果は解決対象の DSL effect index を持つので textRef でピンポイント抽出する
  // (キーワード抽出だと複数起動効果カードで先頭ブロックを誤抽出する: P3-61 同型)。
  if (
    action.actionKind === "hand_card_effect" &&
    action.handActivatedEffectIndex !== undefined
  ) {
    const text = extractTriggeredEffectTextByEffectIndex(
      def,
      action.handActivatedEffectIndex
    );
    if (text) return text;
  }
  // スタック化された誘発効果は registration → effectIndex → textRef で解決する。
  // 「召喚されたとき」のような見出し無し game_event でも eventKind キーワード抽出で
  // カード全文を拾わないようにする (通常の誘発キュー経路と同じピンポイント手法)。
  if (action.actionKind === "triggered_effect") {
    const registrations = action.triggeredSourceCardNo
      ? getRegisteredTriggeredEffectActions(action.triggeredSourceCardNo)
      : undefined;
    const effectIndex =
      action.triggeredRegistrationIndex !== undefined
        ? registrations?.[action.triggeredRegistrationIndex]?.effectIndex
        : undefined;
    const text = extractTriggeredEffectTextByEffectIndex(def, effectIndex);
    if (text) return text;
  }
  // 宣言待ちからスタックへ移った後も、同じ登録番号を本文の識別子として使う。
  if (action.actionKind === "battle_immediate_effect") {
    const text = extractBattleImmediateEffectTextByRegistrationIndex(
      def,
      action.battleImmediateRegistrationIndex ??
        action.battleImmediatePromptSnapshot?.registrationIndex
    );
    if (text) return text;
  }
  if (action.actionKind === "burst_activation") {
    const text = extractBurstEffectTextByRegistrationIndex(
      def,
      action.burstRegistrationIndex
    );
    if (text) return text;
  }
  const mechanicEffects =
    action.actionKind === "divine_skill" &&
    action.divineSkillIndex !== undefined
      ? def?.grandwalkerData?.divineSkills?.[action.divineSkillIndex]?.effects
      : action.actionKind === "accel"
        ? def?.accelData?.effects
        : action.actionKind === "change"
          ? def?.changeData?.effects
          : undefined;
  if (mechanicEffects) {
    const text = joinTextRef(
      def,
      mechanicEffects.flatMap((effect) => effect.textRef ?? [])
    );
    if (text) return text;
  }
  // マジックは chosenTiming 一致 activated 効果の textRef を優先 (複数効果カードの誤抽出回避)。
  if (action.actionKind === "magic") {
    const text = magicEffectText(
      def,
      action.chosenTiming,
      action.magicEffectIndex
    );
    if (text) return text;
  }
  if (
    action.actionKind === "activate_soul_state" &&
    action.sourceEffectIndex !== undefined
  ) {
    const text = extractTriggeredEffectTextByEffectIndex(
      def,
      action.sourceEffectIndex
    );
    if (text) return text;
  }
  return extractEffectText(def, stackActionTiming(action));
}

function stackActionTiming(action: {
  actionKind: string;
  chosenTiming?: "main" | "flash" | "stack";
  triggeredPendingSnapshot?: PendingTriggeredEffect;
  battleImmediatePromptSnapshot?: BattleImmediateEffect;
}): string {
  switch (action.actionKind) {
    case "magic":
      return action.chosenTiming ?? "flash";
    case "field_card_effect":
      return action.chosenTiming ?? "flash";
    case "triggered_effect":
      return action.triggeredPendingSnapshot?.eventKind ?? "summon";
    case "battle_immediate_effect":
      return action.battleImmediatePromptSnapshot?.timing ?? "attack";
    case "summon":
      return "summon";
    case "place_nexus":
      return "place";
    // 専用ブロック (『アクセル』『チェンジ』【バースト】【神技/アーツ】) を持つ
    // 使用系。キーワード抽出でカード全文ではなく該当ブロックを表示する。
    case "accel":
      return "accel";
    case "change":
      return "change";
    case "burst_activation":
      return "burst";
    case "divine_skill":
      return "divine_skill";
    case "set_mirage":
      return "mirage";
    case "set_quartz":
      return "quartz";
    case "activate_soul_state":
      return "main";
    default:
      return "stack";
  }
}

type BurstQueueWindowKind = "activation" | "effect_declaration" | null;

function stackActionLabel(
  actionKind: string,
  burstWindowKind: BurstQueueWindowKind = null
): string {
  switch (actionKind) {
    case "magic":
      return "マジック";
    case "accel":
      return "アクセル";
    case "change":
      return "チェンジ";
    case "field_card_effect":
      return "効果発揮";
    case "hand_card_effect":
      return "起動効果";
    case "summon":
      return "召喚";
    case "place_nexus":
      return "配置";
    case "burst_activation":
      if (burstWindowKind === "activation") {
        return "バースト発動宣言";
      }
      if (burstWindowKind === "effect_declaration") {
        return "バースト効果発揮宣言";
      }
      return "バースト発動宣言";
    case "triggered_effect":
      return "誘発発揮";
    case "battle_immediate_effect":
      return "即時発揮";
    case "divine_skill":
      return "神技";
    case "set_mirage":
      return "ミラージュセット";
    case "set_quartz":
      return "クォーツセット";
    case "activate_soul_state":
      return "魂状態化";
    default:
      return "スタック応答";
  }
}

/** 表示する効果出典の状態を、宣言前後の全キューで共通表示する。 */
function sourceStateDisplay(
  state: GameState,
  display: ReturnType<typeof getEffectSourceDisplay>
): Pick<EffectQueueItem, "sourceStateLabel" | "displaySourceInstanceId"> {
  const source = display.instanceId
    ? { displaySourceInstanceId: display.instanceId }
    : {};
  const card = state.cardInstances.find(
    (candidate) => candidate.instanceId === display.instanceId
  );
  if (!card) return source;
  if (card.zone !== "field") {
    return { ...source, sourceStateLabel: zoneDisplayLabel(card.zone) };
  }
  // フィールドに残っていても、離脱が確定して flush 待ちなら通常のカード種別ではなく
  // 待機状態として示す。card 側のフラグと pending 一覧のどちらでも復元状態を扱える。
  if (
    card.pendingLeaveKind != null ||
    state.pendingLeaveEntities.some(
      (pendingLeave) =>
        pendingLeave.instanceId === card.instanceId &&
        !pendingLeave.blockedByResistance
    )
  ) {
    return { ...source, sourceStateLabel: "待機状態" };
  }
  if (isAdventSourceUnderCard(state, card)) {
    return { ...source, sourceStateLabel: "煌臨元" };
  }
  if (isSoulStateCard(state, card.instanceId)) {
    return { ...source, sourceStateLabel: "魂状態" };
  }
  const category = display.definition
    ? getEffectiveCategory(state, card, display.definition)
    : undefined;
  return category
    ? { ...source, sourceStateLabel: cardCategoryLabel(category) }
    : source;
}

/**
 * ResolutionItem (rules-core 由来) を UI 用 EffectQueueItem に変換する。
 *
 * rules-core 側は「どの state 項目」と「どのカード候補」までを返し、
 * 画像パスの `/` 付与・効果テキスト抽出・タイミング日本語ラベル等の
 * UI 表示メタは本関数で付加する。
 *
 * triggered で applicability スキャンによって複数 responder が出た場合は、
 * source ごとに 1 カードへ展開する。これにより
 * resolve_pending_triggered_effect (source ごとに 1 件生成される) と
 * キューカードが 1:1 対応し、「画像 1 枚・ボタン複数」の不一致を防ぐ。
 */
function resolutionItemToQueueItems(
  item: ResolutionItem,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined,
  bieByCardTiming: Map<string, number>,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup
): EffectQueueItem[] {
  const primarySource = item.sources[0];
  if (!primarySource) return [];
  const primaryDisplay = getResolutionSourceDisplay(
    state,
    primarySource,
    getDefinition
  );

  switch (item.ref.kind) {
    case "battle_immediate": {
      const bie = item.ref.effect;
      const { instanceId: displayInstanceId, definition: displayDef } =
        primaryDisplay;
      const key = `${displayInstanceId}:${bie.timing}`;
      const matchIdx = bieByCardTiming.get(key) ?? 0;
      bieByCardTiming.set(key, matchIdx + 1);
      const effectDef =
        getDefinition(
          bie.sourceEffectDefinitionId ??
            primarySource.effectDefinitionId ??
            bie.sourceCardNo
        ) ?? displayDef;
      const textRefText = extractBattleImmediateEffectTextByRegistrationIndex(
        effectDef,
        bie.registrationIndex
      );
      return [
        {
          id: item.id,
          kind: "battle_immediate",
          definitionId: primaryDisplay.definitionId,
          imagePath: primaryDisplay.imagePath,
          cardName: primaryDisplay.cardName,
          ...sourceStateDisplay(state, primaryDisplay),
          effectText:
            textRefText ?? extractEffectText(effectDef, bie.timing, matchIdx),
          actingPlayerId: item.actingPlayerId,
          timingLabel: immediateTimingLabel(bie.timing),
          sourceRef: { type: "battleImmediate", data: bie },
        },
      ];
    }
    case "triggered": {
      const pte = item.ref.pendingEffect;
      // step_timing 系: event.step が判明している場合は step 単位のキーワード
      // ("アタックステップ" 等) で抽出して、別 step の効果テキストを拾わないようにする。
      // start_step は全ステップで共有するため、実際のステップ名で本文を絞る。
      const stepKeyword =
        pte.event && "step" in pte.event && typeof pte.event.step === "string"
          ? stepDisplayLabel(pte.event.step)
          : undefined;
      const multiSource = item.sources.length > 1;
      const queueItems: EffectQueueItem[] = [];
      for (const source of item.sources) {
        const display = getResolutionSourceDisplay(
          state,
          source,
          getDefinition
        );
        const displayInstanceId = display.instanceId ?? source.instanceId;
        const displayDefinitionId = display.definitionId;
        const sourceDef = display.definition;
        if (!sourceDef) continue;
        const grantedDisplay =
          pte.mechanic?.kind === "granted_effect"
            ? getGrantedEffectDisplayInfoByCeId(
                state,
                pte.mechanic.grantCeEffectId,
                getDefinition
              )
            : null;
        // source の registrationIndex → 登録 → effectIndex を引いて、効果単位の
        // textRef / timing.kind を解決する。これで「召喚されたとき」のように
        // 見出しを持たない responder でも本文全体を誤抽出せず、ラベルも
        // card_event「召喚時」と game_event「召喚されたとき」を区別できる。
        const registration =
          source.registrationIndex !== undefined
            ? (getRegisteredTriggeredEffectActions(displayDefinitionId)?.[
                source.registrationIndex
              ] ??
              getRegisteredTriggeredEffectActions(source.definitionId)?.[
                source.registrationIndex
              ])
            : undefined;
        const effectIndex = registration?.effectIndex;
        const effect =
          grantedDisplay?.effect ??
          (effectIndex !== undefined
            ? sourceDef.effects?.[effectIndex]
            : undefined);
        const timingKind =
          effect !== undefined ? effect.timing?.kind : undefined;
        const textRefText = extractTriggeredEffectTextByEffectIndex(
          sourceDef,
          effectIndex
        );
        const grantedEffectText =
          grantedDisplay !== null
            ? (grantedDisplay.text ?? grantedDisplay.effect.heading ?? "")
            : null;
        const triggerPhrases =
          effect !== undefined
            ? deriveTriggerPhrasesFromTextRefs(
                effect,
                grantedDisplay?.sourceDefinition?.textLines ??
                  sourceDef.textLines
              )
            : undefined;
        const triggerCause =
          pte.cause ??
          (pte.event && "cause" in pte.event ? pte.event.cause : undefined);
        const queueItem: EffectQueueItem = {
          // 複数 responder のときは source ごとに id を一意化する。単一 source の
          // ときは既存挙動 (focusStack / テスト) との互換のため item.id を維持。
          id: multiSource
            ? `${item.id}__${displayInstanceId}-${source.registrationIndex ?? 0}`
            : item.id,
          kind: "triggered",
          definitionId: displayDefinitionId,
          imagePath: display.imagePath,
          cardName: display.cardName,
          ...sourceStateDisplay(state, display),
          // textRef (効果単位) を最優先。無ければ step / eventKind keyword 抽出。
          // mechanic 由来 (神託/解封/転醒) は eventKind=mechanic kind なので
          // TIMING_KEYWORDS 経由で印字された機構ブロック (【神託：…】等) を抽出する。
          effectText:
            grantedEffectText ??
            textRefText ??
            (stepKeyword
              ? extractEffectText(sourceDef, stepKeyword)
              : extractEffectText(
                  sourceDef,
                  pte.eventKind,
                  source.registrationIndex
                )),
          actingPlayerId: item.actingPlayerId,
          timingLabel: triggeredTimingLabel(
            pte.eventKind,
            timingKind,
            triggerPhrases,
            triggerCause
          ),
          sourceInstanceId: displayInstanceId,
          sourceRef: { type: "triggered", data: pte },
        };
        if (source.registrationIndex !== undefined) {
          queueItem.registrationIndex = source.registrationIndex;
        }
        if (item.simultaneousGroupId) {
          queueItem.simultaneousGroupId = item.simultaneousGroupId;
        }
        queueItems.push(queueItem);
      }
      return queueItems;
    }
    case "stack_battle_flash": {
      const window = item.ref.window;
      const sa = window.pendingStackAction;
      if (!sa) return [];
      const displayDef = primaryDisplay.definition;
      return [
        {
          id: item.id,
          kind: "stack_battle_flash",
          definitionId: primaryDisplay.definitionId,
          imagePath: primaryDisplay.imagePath,
          cardName: primaryDisplay.cardName,
          ...sourceStateDisplay(state, primaryDisplay),
          effectText: stackActionEffectText(
            displayDef,
            sa,
            getRegisteredTriggeredEffectActions
          ),
          actingPlayerId: item.actingPlayerId,
          timingLabel: stackQueueTimingLabel(state, sa, getDefinition),
          sourceRef: { type: "stackBattleFlash", data: window },
        },
      ];
    }
    case "stack": {
      const window = item.ref.window;
      const sa = window.pendingStackAction;
      if (!sa) return [];
      const displayDef = primaryDisplay.definition;
      return [
        {
          id: item.id,
          kind: "stack",
          definitionId: primaryDisplay.definitionId,
          imagePath: primaryDisplay.imagePath,
          cardName: primaryDisplay.cardName,
          ...sourceStateDisplay(state, primaryDisplay),
          effectText: stackActionEffectText(
            displayDef,
            sa,
            getRegisteredTriggeredEffectActions
          ),
          actingPlayerId: item.actingPlayerId,
          timingLabel: stackQueueTimingLabel(
            state,
            sa,
            getDefinition,
            window.burstWindowKind
          ),
          sourceRef: { type: "stack", data: window },
        },
      ];
    }
    case "stack_pre_declaration": {
      const window = item.ref.window;
      const sa = window.pendingStackAction;
      if (!sa) return [];
      const displayDef = primaryDisplay.definition;
      return [
        {
          id: item.id,
          kind: "stack_pre_declaration",
          definitionId: primaryDisplay.definitionId,
          imagePath: primaryDisplay.imagePath,
          cardName: primaryDisplay.cardName,
          ...sourceStateDisplay(state, primaryDisplay),
          effectText: stackActionEffectText(
            displayDef,
            sa,
            getRegisteredTriggeredEffectActions
          ),
          actingPlayerId: item.actingPlayerId,
          timingLabel: stackQueueTimingLabel(state, sa, getDefinition),
          sourceRef: { type: "stackPreDeclaration", data: window },
        },
      ];
    }
  }
}

type ResolvePendingBurstCheckAction = Extract<
  LegalAction,
  { kind: "resolve_pending_burst_check" }
>;
type DeclinePendingBurstCheckAction = Extract<
  LegalAction,
  { kind: "decline_pending_burst_check" }
>;

function isPendingBurstCheckAction(
  action: LegalAction
): action is ResolvePendingBurstCheckAction | DeclinePendingBurstCheckAction {
  return (
    action.kind === "resolve_pending_burst_check" ||
    action.kind === "decline_pending_burst_check"
  );
}

/** 発動条件の事象と、公開された原因カードを宣言前後で共通表示する。 */
function burstCauseLabel(
  pending: PendingBurstCheck,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): string {
  const event =
    pending.event ?? burstEventKindToStructuredEvent(pending.eventKind);
  const player =
    pending.relatedPlayerId === pending.actingPlayerId ? "自分" : "相手";
  const timing = event.actionKind
    ? event.actionKind === "magic_use"
      ? "マジック使用時"
      : triggerEventLabel(
          event.actionKind === "placement" ? "place" : event.actionKind
        )
    : undefined;
  let cause: string;
  switch (event.family) {
    case "hand_increase":
      cause = pending.amount > 0 ? `手札＋${pending.amount}枚` : "手札増加";
      break;
    case "life":
      cause = pending.amount > 0 ? `ライフ－${pending.amount}` : "ライフ減少";
      break;
    case "action_after":
    case "action_declared":
      cause = event.actionKind === "block" ? "ブロック" : "アタック";
      break;
    case "enter_field":
      cause = timing?.replace(/時$/, "") ?? "フィールド登場";
      break;
    case "leave_field":
      cause = event.causeKind
        ? triggerEventLabel(event.causeKind).replace(/時$/, "")
        : "フィールド離脱";
      break;
    case "effect_activation":
      cause = timing ? `${timing}効果発揮` : "効果発揮";
      break;
    case "step_timing":
      cause = `${stepDisplayLabel(event.step ?? pending.step)}${
        event.subPhase === "end" ? "終了" : "開始"
      }`;
      break;
    case "state_change":
      cause = timing?.replace(/時$/, "") ?? "疲労";
      break;
    case "soul_state_change":
      cause = "魂状態化";
      break;
    default:
      return "条件成立";
  }
  const source = state.cardInstances.find(
    (card) =>
      card.instanceId ===
      (event.effectSourceInstanceId ?? pending.relatedInstanceId)
  );
  const sourceDefinitionId =
    event.effectSourceDefinitionId ??
    (source?.faceDown ? undefined : source?.definitionId);
  const sourceName = sourceDefinitionId
    ? getDefinition(sourceDefinitionId)?.name
    : undefined;
  return `${player}の${cause}${sourceName ? `（${sourceName}）` : ""}`;
}

function stackQueueTimingLabel(
  state: GameState,
  action: Pick<
    ActiveStack,
    "actionKind" | "burstCheckId" | "burstPendingSnapshot"
  >,
  getDefinition: (id: string) => CardDefinition | undefined,
  burstWindowKind: BurstQueueWindowKind = null
): string {
  const pending =
    action.actionKind === "burst_activation"
      ? (action.burstPendingSnapshot ??
        state.pendingBurstChecks.find(
          (check) => check.checkId === action.burstCheckId
        ))
      : undefined;
  const cause = pending
    ? `：${burstCauseLabel(pending, state, getDefinition)}`
    : "";
  return `${stackActionLabel(action.actionKind, burstWindowKind)}${cause}・応答待ち`;
}

function pendingBurstCheckToQueueItem(
  pending: PendingBurstCheck,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined,
  legalActions: readonly LegalAction[]
): EffectQueueItem | null {
  const relatedActions = legalActions.filter(
    (action) =>
      isPendingBurstCheckAction(action) && action.checkId === pending.checkId
  );
  if (relatedActions.length === 0) return null;

  const resolveActions = relatedActions.filter(
    (action): action is ResolvePendingBurstCheckAction =>
      action.kind === "resolve_pending_burst_check"
  );
  const sourceAction =
    resolveActions.find(
      (action) =>
        action.sourceInstanceId !== undefined &&
        action.sourceDefinitionId !== undefined
    ) ?? resolveActions[0];
  // 発動禁止などで発動候補がない確認は、選択キューとして表示しない。
  if (!sourceAction) return null;
  const sourceInstanceId =
    sourceAction?.sourceInstanceId ??
    state.setBurstStates.find(
      (setBurst) => setBurst.playerId === pending.actingPlayerId
    )?.cardInstanceId;
  const sourceCard =
    sourceInstanceId !== undefined
      ? state.cardInstances.find((card) => card.instanceId === sourceInstanceId)
      : undefined;
  const definitionId =
    sourceAction?.sourceDefinitionId ??
    sourceCard?.definitionId ??
    sourceAction?.sourceCardNo ??
    "_hidden_card_";
  const display = getEffectSourceDisplay(
    state,
    {
      sourceInstanceId,
      sourceDefinitionId: definitionId,
    },
    (id) =>
      getDefinition(id) ??
      (id === definitionId && sourceAction?.sourceCardNo
        ? getDefinition(sourceAction.sourceCardNo)
        : undefined)
  );
  const def = display.definition;
  const effectText =
    sourceAction?.registrationIndex !== undefined
      ? (extractBurstEffectTextByRegistrationIndex(
          def,
          sourceAction.registrationIndex
        ) ?? extractEffectText(def, "burst"))
      : extractEffectText(def, "burst");
  const item: EffectQueueItem = {
    id: `burst-${pending.checkId}`,
    kind: "burst_check",
    definitionId: display.definitionId,
    imagePath: display.imagePath,
    cardName: def?.name ?? sourceAction?.sourceCardNo ?? "セット中バースト",
    ...sourceStateDisplay(state, display),
    effectText,
    actingPlayerId: pending.actingPlayerId,
    timingLabel: `バースト発動：${burstCauseLabel(pending, state, getDefinition)}`,
    sourceRef: { type: "burstCheck", data: pending },
  };
  if (sourceInstanceId !== undefined) {
    item.sourceInstanceId = sourceInstanceId;
  }
  if (sourceAction?.registrationIndex !== undefined) {
    item.registrationIndex = sourceAction.registrationIndex;
  }
  if (pending.simultaneousGroupId) {
    item.simultaneousGroupId = pending.simultaneousGroupId;
  }
  return item;
}

/**
 * P3-86 Phase 3: このキュー項目を「前に進める」legal action か判定する
 * (item↔action 単一正源)。
 * - private_declaration: declare/skip_private_triggered_effect (declarationId 一致)
 * - burst_check: resolve/decline_pending_burst_check (checkId 一致)
 * - triggered: resolve_pending_triggered_effect / select_pending_to_resolve
 *   (pendingId + source + registrationIndex 一致)
 * - battle_immediate: resolve_battle_immediate_effect (promptId 一致)
 * - stack 系: なし (パスはグローバル行動として扱う)
 * 召喚/使用/パス等の新規行動はどの項目も claim しない (unclaimed = グローバル)。
 */
export function queueItemClaimsAction(
  item: EffectQueueItem,
  action: LegalAction
): boolean {
  switch (item.sourceRef.type) {
    case "privateDeclaration": {
      if (
        action.kind !== "declare_private_triggered_effect" &&
        action.kind !== "skip_private_triggered_effect"
      ) {
        return false;
      }
      return (
        (action as { declarationId?: string }).declarationId ===
        item.sourceRef.data.declarationId
      );
    }
    case "triggered": {
      const pendingId = item.sourceRef.data.pendingId;
      if (
        action.kind === "select_pending_to_resolve" ||
        action.kind === "resolve_pending_triggered_effect"
      ) {
        const a = action as TriggeredQueueSourceAction;
        if (a.pendingId !== pendingId) return false;
        return triggeredQueueSourceMatches(item, a);
      }
      return false;
    }
    case "battleImmediate": {
      return (
        action.kind === "resolve_battle_immediate_effect" &&
        (action as { promptId?: string }).promptId ===
          item.sourceRef.data.promptId
      );
    }
    case "burstCheck": {
      const checkId = item.sourceRef.data.checkId;
      if (
        action.kind !== "resolve_pending_burst_check" &&
        action.kind !== "decline_pending_burst_check"
      ) {
        return false;
      }
      if ((action as { checkId?: string }).checkId !== checkId) return false;
      if (action.kind === "decline_pending_burst_check") return true;

      const a = action as {
        sourceInstanceId?: string;
        registrationIndex?: number;
      };
      if (
        item.sourceInstanceId &&
        a.sourceInstanceId &&
        a.sourceInstanceId !== item.sourceInstanceId
      ) {
        return false;
      }
      if (
        item.registrationIndex !== undefined &&
        a.registrationIndex !== undefined &&
        a.sourceInstanceId === item.sourceInstanceId &&
        a.registrationIndex !== item.registrationIndex
      ) {
        return false;
      }
      return true;
    }
    case "stack":
    case "stackBattleFlash":
    case "stackPreDeclaration":
      return false;
  }
}

/** キュー操作は未対応項目でもグローバル操作へ昇格させない。 */
export function isActionForEffectQueueFront(
  action: LegalAction,
  front: EffectQueueItem | undefined
): boolean {
  switch (action.kind) {
    case "select_pending_to_resolve":
    case "resolve_pending_triggered_effect":
    case "resolve_battle_immediate_effect":
    case "declare_private_triggered_effect":
    case "skip_private_triggered_effect":
    case "resolve_pending_burst_check":
    case "decline_pending_burst_check":
      return front !== undefined && queueItemClaimsAction(front, action);
    default:
      return true;
  }
}

/** 表示対象を失った保存済みキューも、選択を要求せず整理する。 */
export function isAutomaticEffectQueueDrain(
  action: LegalAction,
  items: readonly EffectQueueItem[]
): boolean {
  if (action.kind === "resolve_pending_triggered_effect") {
    // A visible optional effect keeps its explicit decline, including when
    // conditional-cost availability leaves no executable variant.
    const visibleOptional =
      action.executionMode === "optional" &&
      items.some((item) => queueItemClaimsAction(item, action));
    return (
      (action.skipOnly === true && !visibleOptional) || !action.sourceInstanceId
    );
  }
  return (
    (action.kind === "select_pending_to_resolve" ||
      action.kind === "decline_pending_burst_check") &&
    !items.some((item) => queueItemClaimsAction(item, action))
  );
}

type TriggeredQueueSourceAction = {
  pendingId?: string;
  sourceInstanceId?: string;
  sourceEffectInstanceId?: string;
  registrationIndex?: number;
};

function triggeredQueueSourceMatches(
  item: EffectQueueItem,
  action: TriggeredQueueSourceAction
): boolean {
  const actionDisplaySourceInstanceId =
    action.sourceEffectInstanceId ?? action.sourceInstanceId;
  // 1 pending 複数 responder: front カードの source / registration に対応する 1 件のみ。
  // source metadata が無い select は pending 全体の順序選択として扱い、従来どおり claim する。
  if (
    item.sourceInstanceId &&
    actionDisplaySourceInstanceId &&
    actionDisplaySourceInstanceId !== item.sourceInstanceId
  ) {
    return false;
  }
  if (
    item.registrationIndex !== undefined &&
    action.registrationIndex !== undefined &&
    actionDisplaySourceInstanceId === item.sourceInstanceId &&
    action.registrationIndex !== item.registrationIndex
  ) {
    return false;
  }
  return true;
}

/** 同じイベントを共有していても、選択された発揮元・登録効果だけを前面化する。 */
export function isSelectedTriggeredQueueItem(item: EffectQueueItem): boolean {
  if (item.sourceRef.type !== "triggered") return false;
  const pending = item.sourceRef.data;
  return (
    pending.selectedByTurnPlayer === true &&
    triggeredQueueSourceMatches(item, {
      ...(pending.selectedSourceInstanceId !== undefined
        ? { sourceInstanceId: pending.selectedSourceInstanceId }
        : {}),
      ...(pending.selectedSourceEffectInstanceId !== undefined
        ? { sourceEffectInstanceId: pending.selectedSourceEffectInstanceId }
        : {}),
      ...(pending.selectedRegistrationIndex !== undefined
        ? { registrationIndex: pending.selectedRegistrationIndex }
        : {}),
    })
  );
}

/**
 * P3-86 案X: `actions` に declare_private_triggered_effect があれば、対応する
 * private_declaration キュー項目の id (`ppd-<declarationId>`) を返す。無ければ null。
 * 「actionable な非公開宣言を前面化する」判定の正源 (overlay の focus 同期で使用)。
 * legal-actions は pendingPrivateDeclarations[0] のみ declare を surface し、deferred 中
 * (応答窓が開いている間) は declare action が無いので null = 前面を被応答スタックのまま維持。
 */
export function actionablePrivateDeclarationFrontId(
  actions: readonly LegalAction[] | undefined
): string | null {
  const declareAction = actions?.find(
    (a) => a.kind === "declare_private_triggered_effect"
  );
  if (!declareAction) return null;
  const declId = (declareAction as { declarationId?: string }).declarationId;
  return declId ? `ppd-${declId}` : null;
}

export function buildEffectQueue(
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  viewingPlayerId: string,
  legalActions: readonly LegalAction[] = []
): EffectQueueItem[] {
  const resolutionItems = buildResolutionItems({
    state,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions,
  });
  // 同カード・同 timing の bie を区別するため registrationIndex でグループ化
  const bieByCardTiming = new Map<string, number>();
  const items: EffectQueueItem[] = [];
  for (const declaration of state.pendingPrivateDeclarations) {
    if (declaration.ownerPlayerId !== viewingPlayerId) continue;
    // private 宣言の effectSource* は誘発を起こしたカード。発揮元とは別。
    const display = getEffectSourceDisplay(
      state,
      {
        sourceInstanceId: declaration.sourceInstanceId,
        sourceDefinitionId: declaration.sourceDefinitionId,
      },
      getDefinition
    );
    const def = display.definition;
    if (!def) continue;
    const registration = getRegisteredTriggeredEffectActions(
      declaration.sourceDefinitionId
    )?.[declaration.registrationIndex];
    const textRefText = extractTriggeredEffectTextByEffectIndex(
      def,
      registration?.effectIndex
    );
    items.push({
      id: `ppd-${declaration.declarationId}`,
      kind: "private_declaration",
      definitionId: display.definitionId,
      imagePath: display.imagePath,
      cardName: display.cardName,
      ...sourceStateDisplay(state, display),
      effectText:
        textRefText ??
        extractEffectText(
          def,
          declaration.eventKind,
          declaration.registrationIndex
        ),
      actingPlayerId: declaration.actingPlayerId,
      timingLabel: triggerEventLabel(declaration.eventKind),
      sourceRef: { type: "privateDeclaration", data: declaration },
    });
  }
  for (const item of resolutionItems) {
    const queueItems = resolutionItemToQueueItems(
      item,
      state,
      getDefinition,
      bieByCardTiming,
      getRegisteredTriggeredEffectActions
    );
    items.push(...queueItems);
  }
  for (const pending of state.pendingBurstChecks) {
    const burstItem = pendingBurstCheckToQueueItem(
      pending,
      state,
      getDefinition,
      legalActions
    );
    if (burstItem) items.push(burstItem);
  }
  // P3-86 Phase 3: 各項目に「それを前に進める legal action」を紐づける (item↔action 単一正源)。
  return items.map((item) => ({
    ...item,
    actions: legalActions.filter((a) => queueItemClaimsAction(item, a)),
  }));
}

// ---------------------------------------------------------------------------
// Kind → badge color / label
// ---------------------------------------------------------------------------

function kindBadgeInfo(kind: EffectQueueItemKind): {
  color: string;
  label: string;
} {
  switch (kind) {
    case "battle_immediate":
      return { color: "#e53e3e", label: "即時" };
    case "private_declaration":
      return { color: "#805ad5", label: "宣言" };
    case "burst_check":
      return { color: "#3182ce", label: "バースト" };
    case "triggered":
      return { color: "#38a169", label: "誘発" };
    case "stack_battle_flash":
      return { color: "#ed8936", label: "スタック" };
    case "stack":
      return { color: "#ed8936", label: "スタック" };
    case "stack_pre_declaration":
      return { color: "#ed8936", label: "スタック" };
  }
}

// ---------------------------------------------------------------------------
// EffectQueueCardItem — 1 カード分の DOM。
// クリック = 前面化、
// 長押し / 右クリック = カード詳細。
// ---------------------------------------------------------------------------

function EffectQueueCardItem({
  item,
  isActive,
  isSelf,
  isRight,
  badge,
  cardStyle,
  hasNavigation,
  listLabel,
  canSelect = true,
  onPrimary,
  onOpenDetail,
}: {
  item: EffectQueueItem;
  isActive: boolean;
  isSelf: boolean;
  isRight: boolean;
  badge: { color: string; label: string };
  cardStyle: React.CSSProperties;
  hasNavigation: boolean;
  listLabel?: string;
  canSelect?: boolean;
  onPrimary: () => void;
  onOpenDetail: () => void;
}) {
  const lp = useLongPress(onOpenDetail);
  return (
    <div
      className={`effect-queue-card ${isActive ? "active" : "behind"}${hasNavigation ? " has-navigation" : ""}`}
      data-side={isRight ? "right" : "left"}
      data-queue-item-id={item.id}
      role={listLabel ? "button" : undefined}
      tabIndex={listLabel ? 0 : undefined}
      aria-label={listLabel}
      aria-pressed={listLabel ? isActive : undefined}
      aria-disabled={listLabel ? !canSelect : undefined}
      style={cardStyle}
      {...lp.handlers}
      onPointerCancel={lp.cancel}
      onKeyDown={(event) => {
        if (listLabel && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onPrimary();
        }
      }}
      onClick={() => {
        if (lp.consumeFired()) return;
        onPrimary();
      }}
    >
      {listLabel && (
        <div className="effect-queue-list-card-title">{listLabel}</div>
      )}
      <div className="effect-queue-card-image">
        {item.imagePath ? (
          <img src={item.imagePath} alt={item.cardName} />
        ) : (
          <img src="/images/ForGUI/card-back.jpg" alt="非公開のカード" />
        )}
        <div className="effect-queue-labels">
          <span
            className="effect-queue-badge"
            style={{ backgroundColor: badge.color }}
          >
            {badge.label}
          </span>
          {item.sourceStateLabel && (
            <span className="effect-queue-source-state">
              {item.sourceStateLabel}
            </span>
          )}
        </div>
        <span className={`effect-queue-player ${isSelf ? "self" : "opponent"}`}>
          {isSelf ? "自分" : "相手"}
        </span>
        {/* 解決順番号バッジは廃止。順序は「次に解決する 1 件を都度タップ選択」
            モデル (P3-35 Phase 3) に統一されており、配列位置ベースの固定番号は
            確定順を意味せず誤解を招くため表示しない。 */}
      </div>
      <div className="effect-queue-text">
        <div className="effect-queue-timing">{item.timingLabel}</div>
        {/* 効果テキスト空欄 (召喚/配置スタック等) でも is-blank で高さを確保し、
            折りたたまずテキスト有りカードと一貫させる。 */}
        <div
          className={`effect-queue-description${
            item.effectText ? "" : " is-blank"
          }`}
        >
          {item.effectText}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EffectQueueOverlayProps {
  state: GameState;
  getDefinition: (id: string) => CardDefinition | undefined;
  /** triggered effect の applicability スキャン用 (rules-core 由来 lookup) */
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  viewingPlayerId: string;
  /** 前面化できるキュー項目の判定と ActionBar の表示対象作成に使う。 */
  actions?: readonly LegalAction[];
  /**
   * 可視 front (focusStack 末尾) の item.id を親へ報告する。
   * 1 pending に複数 responder が乗る triggered では pendingId だけでは
   * ActionBar の resolve action を 1 件に絞れないため、overlay が表示している
   * 前面カードの id を唯一の真実として親 (ActionBar フィルタ) と共有する。
   */
  onActiveItemChange?: (itemId: string | null) => void;
  /**
   * 表示状態。親 (BattleScreen) が制御する。
   * - true: 解決キューカードを表示 (トグルラベル "盤面確認")
   * - false: 解決待ち N のトグルだけを表示 (キューカード本体は隠す)
   *
   * autoHide ロジック (対象選択 / コスト支払い中の自動非表示) と
   * 「キュー非表示中の ActionBar 連動」(stack/flash pass 以外を隠す) は
   * 親側で同じ visible 状態を共有するため、本コンポーネントには持たせない。
   */
  visible: boolean;
  onToggleVisible: () => void;
}

const CARD_OFFSET_X = 55;
const CARD_OFFSET_Y = 10;

export function EffectQueueOverlay({
  state,
  getDefinition,
  getRegisteredTriggeredEffectActions,
  viewingPlayerId,
  actions,
  onActiveItemChange,
  visible,
  onToggleVisible,
}: EffectQueueOverlayProps) {
  const items = useMemo(
    () =>
      buildEffectQueue(
        state,
        getDefinition,
        getRegisteredTriggeredEffectActions,
        viewingPlayerId,
        actions ?? []
      ),
    [
      state,
      getDefinition,
      getRegisteredTriggeredEffectActions,
      viewingPlayerId,
      actions,
    ]
  );

  // クリックでアテンション (= focused) を切り替えるための UI ローカル状態。
  // 扇形レイアウトで意味を持つのは「末尾 = focused (= 中央下の頂点)」だけ。
  // 残りのカード位置は items 配列順 (= naturalIdx) と focused からの距離で決まるため、
  // focusStack の先頭〜中間の並び順はレイアウトに影響しない (focused 選択の履歴に過ぎない)。
  // クリック (= アテンション切替) は item.id を末尾に移動するだけで、items 配列は並べ替えない。
  // selectedByTurnPlayer (P3-37) はゲームロジック由来の選択状態として focusStack へ反映する。
  const computeInitialFocusStack = (its: EffectQueueItem[]): string[] => {
    const ids = its.map((i) => i.id);
    const selectedIdx = its.findIndex(isSelectedTriggeredQueueItem);
    if (selectedIdx < 0 || selectedIdx === ids.length - 1) return ids;
    const result = [...ids];
    const [selected] = result.splice(selectedIdx, 1);
    if (selected !== undefined) result.push(selected);
    return result;
  };
  const [focusStackIds, setFocusStackIds] = useState<string[]>(() =>
    computeInitialFocusStack(items)
  );

  // items の出入りに focusStack を ID ベースで同期する。
  // 消えた id を取り除き、新規 id は末尾 (= 前面) に追加する。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- items 変更時の UI 同期
    setFocusStackIds((prev) => {
      const itemIds = items.map((i) => i.id);
      const itemIdsSet = new Set(itemIds);
      const filtered = prev.filter((id) => itemIdsSet.has(id));
      const filteredSet = new Set(filtered);
      const additions = itemIds.filter((id) => !filteredSet.has(id));
      if (filtered.length === prev.length && additions.length === 0) {
        return prev;
      }
      return [...filtered, ...additions];
    });
  }, [items]);

  // selectedByTurnPlayer な triggered があれば focusStack 末尾へ移動 (= 前面化)。
  // ターンプレイヤーが「次に解決する pending」を選んだ結果をビジュアルに反映する。
  useEffect(() => {
    const selected = items.find(isSelectedTriggeredQueueItem);
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ゲーム状態 → UI 同期
    setFocusStackIds((prev) => {
      if (prev[prev.length - 1] === selected.id) return prev;
      return [...prev.filter((id) => id !== selected.id), selected.id];
    });
  }, [items]);

  // 発揮前チェックポイントで declare 可能になった非公開宣言 (咲夜 X05 等) を前面化する。
  // `actions` に declare_private_triggered_effect があれば対応する項目を front へ移す。
  // deferred 中 (応答窓が開いている間) は declare action が無いので発火せず、被応答スタックが
  // 前面のまま維持される。これで「前面カード ＝ ActionBar のボタンが効く項目」が一致する。
  //
  // 安定性のための 2 ガード:
  //  - dep を targetId 値にする (`actions` 参照ごとの再発火を抑止)。同一 select 状態のままの
  //    再 render では effect が走らない。
  //  - 既に private declaration が前面のときは user-driven focus を尊重して上書きしない。
  //    (同時 2 件で owner が select を入れ替える間、サーバー確定までの古い actions が一瞬戻すのを防ぐ)
  const actionablePrivateFrontId = actionablePrivateDeclarationFrontId(actions);
  useEffect(() => {
    if (!actionablePrivateFrontId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ゲーム状態 → UI 同期
    setFocusStackIds((prev) => {
      const currentFront = prev[prev.length - 1];
      if (currentFront === actionablePrivateFrontId) return prev; // already at front
      if (currentFront && currentFront.startsWith("ppd-")) {
        // 既に private declaration が前面 (= owner が選択中): 触らない
        return prev;
      }
      if (!prev.includes(actionablePrivateFrontId)) return prev;
      return [
        ...prev.filter((id) => id !== actionablePrivateFrontId),
        actionablePrivateFrontId,
      ];
    });
  }, [actionablePrivateFrontId]);

  // 可視 front (focusStack 末尾) を親へ報告。ActionBar フィルタが overlay と
  // 同じ「前面 1 件」を共有することで、複数 responder 中も表示中カードに対応する
  // resolve action だけが ActionBar に出る。
  const frontItemId =
    focusStackIds.length > 0
      ? (focusStackIds[focusStackIds.length - 1] ?? null)
      : null;
  useEffect(() => {
    onActiveItemChange?.(frontItemId);
  }, [frontItemId, onActiveItemChange]);

  // カード詳細モーダル
  const [detailTarget, setDetailTarget] = useState<{
    card: CardDefinition;
    cardInstance?: CardInstance;
  } | null>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);

  // カード詳細を開く。
  // item.definitionId は画像/カード名と同じ def を指す (全 kind で build 時に設定)。
  // 旧実装は sourceRef.data を直接掘って instanceId/sourceDefinitionId を探していたが、
  // StackWindow / BattleFlashWindowState はカード情報を pendingStackAction.cardDefinitionId に
  // ネストして持つため、通常召喚/配置/マジック等のスタックカードで詳細が開けなかった。
  const openCardDetail = useCallback(
    (item: EffectQueueItem) => {
      const def = getDefinition(item.definitionId);
      if (!def) return;
      detailOpenerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const cardInstance = item.sourceInstanceId
        ? state.cardInstances.find(
            (card) => card.instanceId === item.sourceInstanceId
          )
        : undefined;
      setDetailTarget({
        card: def,
        ...(cardInstance ? { cardInstance } : {}),
      });
    },
    [getDefinition, state.cardInstances]
  );

  // 前面化可能か (= 今この項目に対して操作できるか) を判定する。
  // deferred な項目 (応答窓が開いている間の咲夜 X05 など、declare/skip がまだ surface
  // されていない private_declaration) を前面化すると「前面 ＝ 現在 actionable な決定」の
  // 不変条件が崩れ、ボタンの効かないカードが最前面に来て誤解を招く。そこで:
  //   - stack 系の応答窓 (既定で front。pass/応答はグローバル行動) は常に promotable。
  //   - それ以外は「今この項目を前に進める legal action」が actions にあるときだけ promotable。
  // 非 promotable でも長押し / 右クリックのカード詳細は従来どおり開ける (閲覧は阻害しない)。
  const isPromotable = useCallback(
    (item: EffectQueueItem): boolean => {
      if (
        item.sourceRef.type === "stack" ||
        item.sourceRef.type === "stackBattleFlash" ||
        item.sourceRef.type === "stackPreDeclaration"
      ) {
        return true;
      }
      return (actions ?? []).some((a) => queueItemClaimsAction(item, a));
    },
    [actions]
  );

  // Single click = アテンション切替 (z 最前面化) のみ。
  // 長押し / 右クリック = card detail。
  // ルール状態を確定する `select_pending_to_resolve` は ActionBar の操作（「解決」または任意効果の「発揮する」）からのみ発火する。
  // 前面化の段階では相手効果を含め、別のカードへ何度でも変更できる。
  const handleCardPrimary = useCallback(
    (item: EffectQueueItem) => {
      if (!isPromotable(item)) return; // deferred/非 actionable: 前面化しない
      const isAtFront = focusStackIds[focusStackIds.length - 1] === item.id;
      if (isAtFront) return;
      setFocusStackIds((prev) => [
        ...prev.filter((id) => id !== item.id),
        item.id,
      ]);
    },
    [focusStackIds, isPromotable]
  );

  const focusedRawIdx = items.findIndex((item) => item.id === frontItemId);
  const focusedNaturalIdx =
    focusedRawIdx >= 0 ? focusedRawIdx : items.length - 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [needsNavigation, setNeedsNavigation] = useState(false);
  const [showList, setShowList] = useState(false);
  const detailLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || items.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- キューを閉じたときに一覧も閉じる
      setShowList(false);
    }
  }, [visible, items.length]);

  useEffect(() => {
    if (!detailTarget) return;
    const opener = detailOpenerRef.current;
    detailLayerRef.current
      ?.querySelector<HTMLButtonElement>(".cdm-close")
      ?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [detailTarget]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const cards = cardsRef.current;
    if (!visible || !root || !cards) return;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const origin = cards.getBoundingClientRect();
      const left = Math.max(0, bounds.left);
      const top = Math.max(0, bounds.top);
      const right = Math.min(
        document.documentElement.clientWidth,
        bounds.right
      );
      const bottom = Math.min(
        document.documentElement.clientHeight,
        bounds.bottom
      );
      // CSS の遷移途中ではなく、扇形の到達位置で判定する。
      // 一覧は画像の高さを使うため、表示の有無でこの判定は変わらない。
      const overflows = Array.from(
        cards.querySelectorAll<HTMLElement>(".effect-queue-card")
      ).some((card, index) => {
        const delta = index - focusedNaturalIdx;
        const x = origin.left + delta * CARD_OFFSET_X;
        const y = origin.top - Math.abs(delta) * CARD_OFFSET_Y;
        return (
          x < left ||
          x + card.offsetWidth > right ||
          y < top ||
          y + card.offsetHeight > bottom
        );
      });
      setNeedsNavigation(items.length > 1 && overflows);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(cards);
    for (const card of cards.querySelectorAll(".effect-queue-card"))
      observer.observe(card);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [visible, items, focusedNaturalIdx]);

  if (items.length === 0) return null;

  return (
    <div className="effect-queue-root" ref={rootRef}>
      {/* Toggle button — 解決待ち中 (visible=false) は注意喚起のため点滅光る。 */}
      <button
        className={`effect-queue-toggle${visible ? "" : " is-collapsed"}`}
        onClick={onToggleVisible}
      >
        {visible ? "盤面確認" : `解決待ち ${items.length}`}
      </button>

      {/* Queue overlay */}
      {visible &&
        (() => {
          // レイアウトは「focused (= focusStack 末尾 = 最後にクリックした item) を
          // 底辺の頂点とした扇形 (V 字)」。各カードの位置は focused からの *自然順距離*
          // delta = naturalIdx - focusedNaturalIdx のみで決まり、クリック順 (focusStack の
          // 並び) には依存しない。これにより:
          //   - X 位置は items 配列順で安定 (A 左 / B 中央 / C 右)。
          //   - focused は中央下、その左右のカードは距離に応じて対称に上へ立ち上がる。
          //   - どの順でクリックしても扇形は崩れず、focused だけが入れ替わる。
          // (旧実装は X=自然順・Y/z=focusStack 距離 と二軸を別順序で駆動していたため、
          //  クリックのたびに対角線が交差して「ぐちゃぐちゃ」になっていた。)
          return (
            <div className="effect-queue-overlay">
              <div className="effect-queue-cards" ref={cardsRef}>
                {needsNavigation && (
                  <div
                    className="effect-queue-navigation"
                    style={{ zIndex: items.length + 1 }}
                  >
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={showList}
                      onKeyDown={(event) => event.stopPropagation()}
                      onClick={() => setShowList(true)}
                    >
                      効果一覧（{items.length}件）
                    </button>
                  </div>
                )}
                {items.map((item, naturalIdx) => {
                  // focused からの自然順距離。これ 1 つで X / Y / z をすべて決める。
                  const delta = naturalIdx - focusedNaturalIdx;
                  const distance = Math.abs(delta);
                  const isActive = delta === 0;
                  const isBehind = !isActive;
                  const badge = kindBadgeInfo(item.kind);
                  const isSelf = item.actingPlayerId === viewingPlayerId;
                  // 非 promotable (deferred) は前面化クリックを受け付けない → カーソルで示す。
                  // 前面 (isActive) のカードはクリックしても何も起きないため default。
                  const promotable = isPromotable(item);

                  // X: focused を中央 (X=0) に、items 配列順で左右へ展開。
                  // Y: focused からの距離だけ上へ (両側対称の V 字。focused が最下点)。
                  // z: focused が最前面、focused から遠いほど背面 (近いカードが上に重なる)。
                  const xOffset = delta * CARD_OFFSET_X;
                  const yOffset = -distance * CARD_OFFSET_Y;

                  const cardStyle: React.CSSProperties = {
                    transform: `translateX(${xOffset}px) translateY(${yOffset}px)`,
                    zIndex: items.length - distance,
                    opacity: isBehind ? 0.85 : 1,
                    cursor: promotable && !isActive ? "pointer" : "default",
                  };

                  return (
                    <EffectQueueCardItem
                      key={item.id}
                      item={item}
                      isActive={isActive}
                      isSelf={isSelf}
                      isRight={delta > 0}
                      badge={badge}
                      cardStyle={cardStyle}
                      hasNavigation={isActive && needsNavigation}
                      onPrimary={() => handleCardPrimary(item)}
                      onOpenDetail={() => openCardDetail(item)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })()}

      {visible &&
        showList &&
        createPortal(
          <EffectQueueListDialog
            count={items.length}
            covered={detailTarget !== null}
            onClose={() => setShowList(false)}
          >
            {items.map((item, index) => (
              <EffectQueueCardItem
                key={item.id}
                item={item}
                isActive={index === focusedNaturalIdx}
                isSelf={item.actingPlayerId === viewingPlayerId}
                isRight={false}
                badge={kindBadgeInfo(item.kind)}
                cardStyle={{
                  cursor: isPromotable(item) ? "pointer" : "default",
                }}
                hasNavigation={false}
                listLabel={`${index + 1}. ${item.cardName}`}
                canSelect={isPromotable(item)}
                onPrimary={() => {
                  if (!isPromotable(item)) return;
                  handleCardPrimary(item);
                  setShowList(false);
                }}
                onOpenDetail={() => openCardDetail(item)}
              />
            ))}
          </EffectQueueListDialog>,
          document.body
        )}

      {/* カード詳細モーダル — ポータルで DOM ツリー外に配置 */}
      {detailTarget &&
        createPortal(
          <div
            ref={detailLayerRef}
            onKeyDown={(event) =>
              handleEffectDialogKeyDown(event, () => setDetailTarget(null))
            }
          >
            <CardDetailModal
              card={detailTarget.card}
              {...(detailTarget.cardInstance
                ? {
                    cardInstance: detailTarget.cardInstance,
                    gameState: state,
                    getCardDefinitionById: getDefinition,
                  }
                : {})}
              show
              onClose={() => setDetailTarget(null)}
              hideDeckActions
              zIndex={1100}
            />
          </div>,
          document.body
        )}
    </div>
  );
}
