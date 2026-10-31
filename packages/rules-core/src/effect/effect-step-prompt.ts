import { zoneDisplayLabel, cardCategoryLabel } from "../display-names";
import { effectActionLabel, localizeEffectLabel } from "./action-display";
import type {
  Action,
  Amount,
  CardFilter,
  CoreLocation,
  Count,
  EffectStep,
  PlayerRef,
  TargetSpec,
} from "../dsl-types";
import type {
  EffectStepPrompt,
  PendingStepChoiceOption,
  PendingStepPrompt,
  Zone,
} from "../model";

/** DSL の人称は効果の実行者基準。操作文だけを実際の選択者の視点へ変換する。 */
function labelForChoosingPlayer(
  label: string,
  actingPlayerId: string,
  choosingPlayerId: string
): string {
  if (actingPlayerId === choosingPlayerId) return label;
  // カード名・系統名などの引用部分は固有名詞として保持する。
  return label.replace(/「[^」]*」|自分|相手/g, (word) =>
    word === "自分" ? "相手" : word === "相手" ? "自分" : word
  );
}

export function stepPromptForChoosingPlayer(
  prompt: PendingStepPrompt,
  actingPlayerId: string,
  choosingPlayerId: string,
  source?: {
    textLines: readonly string[] | undefined;
    textRef: readonly number[] | undefined;
  }
): PendingStepPrompt {
  // 解決中の effect から原文を引く。アクセル・神技・借用効果も通常の effects[] と混同しない。
  const sourceText =
    prompt.sourceText ??
    source?.textRef?.map((index) => source.textLines?.[index] ?? "").join("\n");
  const label = labelForChoosingPlayer(
    prompt.label,
    actingPlayerId,
    choosingPlayerId
  );
  return {
    ...prompt,
    ...(sourceText ? { sourceText } : {}),
    label,
    question:
      prompt.question === `「${prompt.label}」を発揮しますか？`
        ? `「${label}」を発揮しますか？`
        : labelForChoosingPlayer(
            prompt.question,
            actingPlayerId,
            choosingPlayerId
          ),
  };
}

/** choice の見出しと枝のラベルも optional 確認文と同じ視点に揃える。 */
export function stepChoicesForChoosingPlayer(
  choices: readonly PendingStepChoiceOption[],
  actingPlayerId: string,
  choosingPlayerId: string
): PendingStepChoiceOption[] {
  return choices.map((choice) => ({
    ...choice,
    label: labelForChoosingPlayer(
      choice.label,
      actingPlayerId,
      choosingPlayerId
    ),
    ...(choice.prompt !== undefined
      ? {
          prompt: stepPromptForChoosingPlayer(
            choice.prompt,
            actingPlayerId,
            choosingPlayerId
          ),
        }
      : {}),
  }));
}

type ActionSummary = {
  label: string;
  question: string;
};

function asQuestion(label: string): string {
  if (label.endsWith("する")) return `${label.slice(0, -2)}しますか？`;
  if (label.endsWith("減らす")) return `${label.slice(0, -3)}減らしますか？`;
  if (label.endsWith("裏返す")) return `${label.slice(0, -3)}裏返しますか？`;
  if (label.endsWith("置く")) return `${label.slice(0, -2)}置きますか？`;
  if (label.endsWith("戻す")) return `${label.slice(0, -2)}戻しますか？`;
  if (label.endsWith("破棄")) return `${label}しますか？`;
  return `${label}しますか？`;
}

function playerPrefix(player: PlayerRef | undefined): string {
  if (player === "self" || player === undefined) return "自分の";
  if (player === "opponent") return "相手の";
  return "";
}

function isZoneArray(zone: Zone | readonly Zone[]): zone is readonly Zone[] {
  return Array.isArray(zone);
}

function zoneLabel(zone: Zone | readonly Zone[], player?: PlayerRef): string {
  if (isZoneArray(zone)) {
    return zone.map((entry) => zoneLabel(entry, player)).join("/");
  }
  return `${playerPrefix(player)}${zoneDisplayLabel(zone)}`;
}

function moveDestinationPhrase(
  zone: Zone | readonly Zone[],
  player?: PlayerRef
): string {
  if (isZoneArray(zone)) return `${zoneLabel(zone, player)}に移動する`;
  if (zone === "hand") return "手札に戻す";
  if (zone === "trash") return `${zoneLabel(zone, player)}に置く`;
  if (zone === "field") return `${zoneLabel(zone, player)}に置く`;
  if (zone === "removed_from_game") return "ゲームから除外する";
  return `${zoneLabel(zone, player)}に置く`;
}

function cardEventLabel(event: string): string {
  const labels: Record<string, string> = {
    summon: "召喚時",
    attack: "アタック時",
    destroy: "破壊時",
    leave_field: "フィールドを離れた時",
    moved_to_trash: "トラッシュに置かれた時",
    revealed: "オープンされた時",
  };
  return labels[event] ?? "効果発揮時";
}

function countLabel(count: Count | Amount, unit: string): string {
  if (count === "all") return unit === "コア" ? "コアすべて" : "すべて";
  if (typeof count === "number") {
    if (unit === "コア") return `コア${count}個`;
    return `${count}${unit}`;
  }
  return `指定数の${unit}`;
}

function categoryLabel(category: readonly string[] | undefined): string {
  if (!category || category.length === 0) return "カード";
  const labels = category.map(cardCategoryLabel);
  return labels.join("/");
}

function cardNameMatchLabel(
  cardName: NonNullable<CardFilter["cardName"]>
): string | undefined {
  const entries = Array.isArray(cardName) ? cardName : [cardName];
  const labels = entries
    .map((entry) => {
      if (entry === "self") return "このカードと同名の";
      if ("contains" in entry) return `カード名に「${entry.contains}」を含む`;
      if ("exact" in entry) return `カード名：「${entry.exact}」の`;
      return undefined;
    })
    .filter((label): label is string => label !== undefined);
  return labels.length > 0 ? labels.join("/") : undefined;
}

function collectFilterCategories(filter: CardFilter): string[] {
  const out = new Set<string>();
  for (const category of filter.category ?? []) out.add(category);
  for (const child of filter.filterOr ?? []) {
    for (const category of collectFilterCategories(child)) out.add(category);
  }
  return [...out];
}

function filterMaxBp(filter: CardFilter): number | undefined {
  const values = [
    filter.maxBp,
    ...(filter.filterOr ?? []).map((child) => filterMaxBp(child)),
  ].filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function filterLabel(filter: CardFilter): string {
  if (filter.targetsGrandwalker === "only") return "創界神ネクサス";
  const maxBp = filterMaxBp(filter);
  const categories = collectFilterCategories(filter);
  const parts: string[] = [];
  if (maxBp !== undefined) parts.push(`BP${maxBp}以下の`);
  if (filter.tribes && filter.tribes.length > 0) {
    parts.push(`系統：「${filter.tribes.join("」/「")}」を持つ`);
  }
  if (filter.cardName) {
    const cardNameLabel = cardNameMatchLabel(filter.cardName);
    if (cardNameLabel) parts.push(cardNameLabel);
  }
  parts.push(categoryLabel(categories));
  return parts.join("");
}

function targetCountSuffix(target: TargetSpec): string {
  if (target.kind !== "filter") return "";
  if (target.count === 1) return "1つ";
  if (typeof target.count === "number") return `${target.count}つ`;
  return "";
}

function targetLabel(target: TargetSpec): string {
  if (target.kind === "self") return "このカード";
  if (target.kind === "source_card") return "このカード";
  if (target.kind === "filter") {
    return `${playerPrefix(target.player)}${filterLabel(target.filter)}${targetCountSuffix(target)}`;
  }
  if (target.kind === "ref") return "参照カード";
  return "対象カード";
}

function countDecreaseAmountLabel(
  amount: Extract<Action, { kind: "count_decrease" }>["amount"]
): string {
  if (typeof amount === "number") return `${amount}`;
  return "好きなだけ";
}

function deckPositionLabel(position: "top" | "bottom"): string {
  return position === "bottom" ? "下" : "上";
}

function searchDestinationPhrase(
  action: Extract<Action, { kind: "search_zone" }>
): string {
  if (action.destination === "hand_or_set_aside_choice") {
    return "手札/手元に戻す";
  }
  if (action.destination === "deck" && action.destinationPosition) {
    return `${zoneLabel("deck", action.player)}の${deckPositionLabel(
      action.destinationPosition
    )}に戻す`;
  }
  return moveDestinationPhrase(action.destination, action.player);
}

function locationLabel(location: CoreLocation): string {
  switch (location.kind) {
    case "void":
      return "ボイド";
    case "reserve":
      return `${playerPrefix(location.player)}リザーブ`;
    case "trash":
      return `${playerPrefix(location.player)}トラッシュ`;
    case "life":
      return `${playerPrefix(location.player)}ライフ`;
    case "outside_game":
      return "ゲーム外";
    case "removed_from_game":
      return "ゲームから除外";
    case "count_area":
      return `${playerPrefix(location.player)}カウントエリア`;
    case "this_card":
      return "このカード";
    case "target_card":
      return "対象カード";
    case "card_instance":
      return "指定カード";
    case "ref":
      return "参照カード";
    case "field_card":
      return `${playerPrefix(location.player)}${filterLabel(location.filter)}1つ`;
    case "field":
      return `${playerPrefix(location.player)}フィールド`;
    case "field_and_reserve_self":
      return "自分のフィールド/リザーブ";
    case "field_reserve_and_trash_self":
      return "自分のフィールド/リザーブ/トラッシュ";
    case "any_movable_self":
      return "自分の移動可能なコア";
    case "non_life_normal_self":
      return "ライフ以外の自分の通常コア";
    default:
      throw new Error(`Unsupported core location kind for step prompt`);
  }
}

function summarizeCoreMove(
  action: Extract<Action, { kind: "core_move" }>
): ActionSummary {
  const to = action.to ? locationLabel(action.to) : "指定場所";
  if (action.amount === "all" && action.from.kind === "field_card") {
    const label = `${locationLabel(action.from)}のコアすべてを${to}に置く`;
    return { label, question: asQuestion(label) };
  }
  const amount = countLabel(action.amount, "コア");
  const label = `${locationLabel(action.from)}から${amount}を${to}に置く`;
  return { label, question: asQuestion(label) };
}

export function summarizeActionForPrompt(
  action: Action
): ActionSummary | undefined {
  switch (action.kind) {
    case "noop": {
      const label =
        action.target !== undefined
          ? `${targetLabel(action.target)}を選ぶ`
          : "効果を実行する";
      return { label, question: asQuestion(label) };
    }
    case "core_move":
      return summarizeCoreMove(action);
    case "deck_reveal": {
      const label = `${playerPrefix(action.player)}デッキを上から${countLabel(
        action.revealCount,
        "枚"
      )}${action.revealTo === "self" ? "内容を見る" : "オープンする"}`;
      return { label, question: asQuestion(label) };
    }
    case "count_increase": {
      const label = `${playerPrefix(action.player)}カウント+${action.amount}する`;
      return { label, question: asQuestion(label) };
    }
    case "count_decrease": {
      const label = `${playerPrefix(action.player)}カウントを${countDecreaseAmountLabel(
        action.amount
      )}減らす`;
      return { label, question: asQuestion(label) };
    }
    case "pay_cost": {
      const label = `${action.amount}コスト支払う`;
      return { label, question: `${action.amount}コスト支払いますか？` };
    }
    case "set_burst": {
      const label = "バースト効果を持つカード1枚をセットする";
      return { label, question: asQuestion(label) };
    }
    case "discard_set_burst": {
      const destination =
        action.destination === "hand" ? "手札に戻す" : "破棄する";
      const label = `${playerPrefix(action.player)}バースト${countLabel(
        action.count,
        "つ"
      )}を${destination}`;
      return { label, question: asQuestion(label) };
    }
    case "destroy": {
      const label = `${targetLabel(action.target)}を破壊する`;
      return { label, question: asQuestion(label) };
    }
    case "bp_modify": {
      const amount =
        typeof action.amount === "number"
          ? `BP${action.amount >= 0 ? "+" : ""}${action.amount}`
          : "BPを指定値";
      const label = `${targetLabel(action.target)}を${amount}する`;
      return { label, question: asQuestion(label) };
    }
    case "bounce": {
      const label = `${targetLabel(action.target)}を${
        action.destination === "hand_or_set_aside_choice"
          ? "手札/手元に戻す"
          : moveDestinationPhrase(action.destination ?? "hand")
      }`;
      return { label, question: asQuestion(label) };
    }
    case "recover": {
      const label = `${targetLabel(action.target)}を回復する`;
      return { label, question: asQuestion(label) };
    }
    case "exhaust": {
      const label = `${targetLabel(action.target)}を${
        action.degree === "heavy_exhaust" ? "重疲労" : "疲労"
      }させる`;
      return { label, question: asQuestion(label) };
    }
    case "draw": {
      const position =
        action.position === "bottom"
          ? "デッキの下から"
          : action.position === "top"
            ? "デッキの上から"
            : "";
      const label = `${position}${countLabel(action.count, "枚")}ドローする`;
      return { label, question: asQuestion(label) };
    }
    case "discard": {
      const label = `${playerPrefix(action.player)}手札を${countLabel(
        action.count,
        "枚"
      )}破棄する`;
      return { label, question: asQuestion(label) };
    }
    case "move_card": {
      const label = `${zoneLabel(
        action.from.zone,
        action.from.player
      )}から${countLabel(action.count, "枚")}を${moveDestinationPhrase(
        action.to.zone,
        action.to.player
      )}`;
      return { label, question: asQuestion(label) };
    }
    case "move_self": {
      const label = `このカードを${moveDestinationPhrase(action.destination)}`;
      return { label, question: asQuestion(label) };
    }
    case "search_zone": {
      const cardLabel = action.filter ? filterLabel(action.filter) : "カード";
      const label = `${zoneLabel(
        action.zone,
        action.player
      )}から${cardLabel}${countLabel(
        action.count,
        "枚"
      )}を${searchDestinationPhrase(action)}`;
      return { label, question: asQuestion(label) };
    }
    case "send_to_deck": {
      const label = `${targetLabel(action.target)}をデッキの${deckPositionLabel(
        action.position
      )}に戻す`;
      return { label, question: asQuestion(label) };
    }
    case "summon": {
      const label = "カードを召喚する";
      return { label, question: asQuestion(label) };
    }
    case "put": {
      const label = "カードをフィールドに出す";
      return { label, question: asQuestion(label) };
    }
    case "place": {
      const label = "カードを配置する";
      return { label, question: asQuestion(label) };
    }
    case "advent": {
      const label = `${targetLabel(action.target)}を【契約煌臨】する`;
      return { label, question: asQuestion(label) };
    }
    case "rebirth": {
      const target =
        action.target !== undefined ? targetLabel(action.target) : "このカード";
      const label = `${target}を裏返す`;
      return { label, question: asQuestion(label) };
    }
    case "reverse_rebirth": {
      const label =
        action.mode === "summon"
          ? "このカードを裏返して配置する"
          : "このカードを裏返す";
      return { label, question: asQuestion(label) };
    }
    case "brave_combine_effect": {
      const label = `${targetLabel(action.target)}に合体する`;
      return { label, question: asQuestion(label) };
    }
    case "end_attack_step": {
      const label = "アタックステップを終了する";
      return { label, question: asQuestion(label) };
    }
    case "grant_extra_steps": {
      const stepNames = action.steps.map((step) => {
        switch (step) {
          case "start":
            return "スタートステップ";
          case "core":
            return "コアステップ";
          case "draw":
            return "ドローステップ";
          case "refresh":
            return "リフレッシュステップ";
          case "main":
            return "メインステップ";
          case "attack":
            return "アタックステップ";
          case "end":
            return "エンドステップ";
          default: {
            const exhaustiveStep: never = step;
            throw new Error(`Unsupported step for prompt: ${exhaustiveStep}`);
          }
        }
      });
      const label = `${stepNames.join("と")}を追加で行う`;
      return { label, question: asQuestion(label) };
    }
    case "core_distribute": {
      const label = `${locationLabel(action.from)}から${countLabel(
        action.amount,
        "コア"
      )}を${targetLabel(action.to)}に置く`;
      return { label, question: asQuestion(label) };
    }
    case "borrow_card_event_effect": {
      const events = action.borrowEvents.map(cardEventLabel).join("/");
      const label = `選んだカードの${events}効果を発揮する`;
      return { label, question: asQuestion(label) };
    }
  }
  const label = effectActionLabel(action.kind);
  return { label, question: `「${label}」を発揮しますか？` };
}

export function buildPendingStepPrompt(
  step: { action: Action; prompt?: EffectStepPrompt | undefined },
  promptOverride?: EffectStepPrompt
): PendingStepPrompt {
  const summary = summarizeActionForPrompt(step.action);
  const prompt = promptOverride ?? step.prompt;
  const label = localizeEffectLabel(
    prompt?.label ??
      summary?.label ??
      prompt?.sourceText ??
      effectActionLabel(step.action.kind)
  );
  return {
    label,
    question: prompt?.question ?? summary?.question ?? asQuestion(label),
    ...(prompt?.sourceText !== undefined
      ? { sourceText: prompt.sourceText }
      : {}),
  };
}

export function buildStepChoicePrompt(step: EffectStep): PendingStepPrompt {
  return {
    label: step.prompt?.label ?? "効果選択",
    question: step.prompt?.question ?? "発揮する効果を選んでください",
    ...(step.prompt?.sourceText !== undefined
      ? { sourceText: step.prompt.sourceText }
      : {}),
  };
}
