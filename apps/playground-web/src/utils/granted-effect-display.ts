import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  DSL,
  Effect,
  GameState,
} from "@orica/rules-core";
import {
  getCEsForTarget,
  getGlobalCEs,
  matchesCardFilter,
  resolveGrantedEffectSourceDefinition,
} from "@orica/rules-core";

export interface GrantedEffectDisplayInfo {
  continuousEffect: ContinuousEffect;
  effect: Effect;
  sourceDefinition: CardDefinition | undefined;
  text: string | null;
}

function isEffect(value: unknown): value is Effect {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Effect>;
  return candidate.timing !== undefined && Array.isArray(candidate.steps);
}

function grantedEffectFromCe(ce: ContinuousEffect): Effect | null {
  const grantedEffect = ce.metadata?.grantedEffect;
  return isEffect(grantedEffect) ? grantedEffect : null;
}

export function extractEffectTextFromTextRef(
  def: CardDefinition | undefined,
  effect: Effect | undefined,
  omittedTextRef?: number
): string | null {
  if (!def || !effect?.textRef || effect.textRef.length === 0) return null;
  const text = [...new Set(effect.textRef)]
    .sort((a, b) => a - b)
    .filter((index) => index !== omittedTextRef)
    .map((index) => def.textLines[index] ?? "")
    .filter((line) => line.length > 0)
    .join("\n");
  return text.length > 0 ? text : null;
}

function getCardDefinitionForInstance(
  state: GameState,
  instanceId: string | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  if (!instanceId) return undefined;
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  return card ? getCardDefinitionById(card.definitionId) : undefined;
}

export function getGrantedEffectDisplayInfoByCeId(
  state: GameState,
  ceEffectId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GrantedEffectDisplayInfo | null {
  const ce = state.activeContinuousEffects.find(
    (candidate) =>
      candidate.effectId === ceEffectId &&
      candidate.modifierTag === "granted_effect"
  );
  if (!ce) return null;
  const effect = grantedEffectFromCe(ce);
  if (!effect) return null;
  const sourceDefinition = resolveGrantedEffectSourceDefinition(
    state,
    ce,
    getCardDefinitionById
  );
  return {
    continuousEffect: ce,
    effect,
    sourceDefinition,
    text: getGrantedEffectText(state, ce, sourceDefinition, effect),
  };
}

function getGrantedEffectText(
  state: GameState,
  ce: ContinuousEffect,
  definition: CardDefinition | undefined,
  effect: Effect
): string | null {
  const parent = state.activeContinuousEffects.find(
    (candidate) => candidate.effectId === ce.metadata?.grantedParentEffectId
  );
  const source = parent?.metadata?.grantedEffectSource as
    | DSL.GrantedEffectSourceSpec
    | undefined;
  // キーワードへの本文中の言及は残し、取得条件の見出し行だけを除く。
  const omittedTextRef =
    source?.kind === "card_effects"
      ? definition?.textLines.findIndex((line) =>
          line.includes(source.afterTextHeader)
        )
      : undefined;
  const text = extractEffectTextFromTextRef(definition, effect, omittedTextRef);
  if (!text) return null;
  if (source?.kind !== "card_effects") return text;
  const events =
    effect.timing.kind === "card_event" ? [effect.timing.event].flat() : [];
  const additionalEvents = ce.metadata?.grantedAdditionalEvents;
  const body = text
    .split("\n")
    .map((line) => {
      let current = source.ignoreLevel
        ? line.replace(/^Lv\d+(?:-Lv\d+)*\s*/, "")
        : line;
      // 条件を再評価せず、エンジンが実際に展開したタイミングに表示を合わせる。
      if (
        source.additionalEvents?.source === "attack" &&
        (events.includes("block") ||
          (Array.isArray(additionalEvents) &&
            additionalEvents.includes("block")))
      )
        current = current.replace(/のアタック時/g, "のアタック/ブロック時");
      return current;
    })
    .filter(Boolean)
    .join("\n");
  if (!body) return null;
  return `${definition!.name}から取得${source.ignoreLevel ? "（Lv条件を無視）" : ""}\n${body}`;
}

function globalContinuousEffectTargetsCard(
  state: GameState,
  ce: ContinuousEffect,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): boolean {
  const targetFilter = ce.targetFilter;
  if (!targetFilter) return false;
  if (targetFilter.player !== "either") {
    const targetPlayerId =
      targetFilter.player === "self"
        ? ce.actingPlayerId
        : state.players.find((player) => player.id !== ce.actingPlayerId)?.id;
    const zonePlayerId =
      card.zone !== "field" ? card.ownerPlayerId : card.controllerPlayerId;
    if (!targetPlayerId || zonePlayerId !== targetPlayerId) return false;
  }
  if (ce.targetExcludeSelf && card.instanceId === ce.sourceInstanceId) {
    return false;
  }

  const { player: _player, ...cardFilter } = targetFilter;
  void _player;
  const sourceDefinition = getCardDefinitionById(ce.sourceDefinitionId);
  return matchesCardFilter(card, def, cardFilter, {
    state,
    ...(sourceDefinition ? { sourceDefinition } : {}),
  });
}

function resolveProvenanceEffectSourceDefinition(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  const provenance = ce.provenance;
  if (!provenance) return undefined;

  if (provenance.effectSourceDefinitionId !== undefined) {
    const def = getCardDefinitionById(provenance.effectSourceDefinitionId);
    if (def) return def;
  }

  return getCardDefinitionForInstance(
    state,
    provenance.effectSourceInstanceId,
    getCardDefinitionById
  );
}

function isProvidedEffectCe(ce: ContinuousEffect): boolean {
  if (ce.modifierTag === "granted_effect") return false;
  const provenance = ce.provenance;
  if (!provenance) return false;
  return (
    (provenance.effectSourceInstanceId !== undefined &&
      provenance.effectSourceInstanceId !== ce.sourceInstanceId) ||
    (provenance.effectSourceDefinitionId !== undefined &&
      provenance.effectSourceDefinitionId !== ce.sourceDefinitionId)
  );
}

function getProvidedEffectDisplayInfo(
  state: GameState,
  ce: ContinuousEffect,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GrantedEffectDisplayInfo | null {
  if (!isProvidedEffectCe(ce)) return null;
  const provenance = ce.provenance;
  if (!provenance) return null;
  const sourceDefinition = resolveProvenanceEffectSourceDefinition(
    state,
    ce,
    getCardDefinitionById
  );
  const effect = sourceDefinition?.effects?.[provenance.effectIndex];
  if (!effect) return null;
  return {
    continuousEffect: ce,
    effect,
    sourceDefinition,
    text: extractEffectTextFromTextRef(sourceDefinition, effect),
  };
}

function providedEffectDisplayKey(info: GrantedEffectDisplayInfo): string {
  const provenance = info.continuousEffect.provenance;
  return [
    provenance?.effectSourceInstanceId ?? "",
    provenance?.effectSourceDefinitionId ?? "",
    provenance?.effectIndex ?? "",
  ].join(":");
}

export function getProvidedEffectsForCard(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GrantedEffectDisplayInfo[] {
  const ces = [
    ...getCEsForTarget(state, card.instanceId),
    ...getGlobalCEs(state).filter((ce) =>
      globalContinuousEffectTargetsCard(
        state,
        ce,
        card,
        def,
        getCardDefinitionById
      )
    ),
  ];
  const seen = new Set<string>();
  const displays: GrantedEffectDisplayInfo[] = [];
  for (const ce of ces) {
    const info = getProvidedEffectDisplayInfo(state, ce, getCardDefinitionById);
    if (!info) continue;
    const key = providedEffectDisplayKey(info);
    if (seen.has(key)) continue;
    seen.add(key);
    displays.push(info);
  }
  return displays;
}

export function getGrantedEffectsForCard(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GrantedEffectDisplayInfo[] {
  const ces = [
    ...getCEsForTarget(state, card.instanceId),
    ...getGlobalCEs(state).filter(
      (ce) =>
        ce.modifierTag === "granted_effect" &&
        globalContinuousEffectTargetsCard(
          state,
          ce,
          card,
          def,
          getCardDefinitionById
        )
    ),
  ];

  return ces
    .filter((ce) => ce.modifierTag === "granted_effect")
    .map((ce) =>
      getGrantedEffectDisplayInfoByCeId(
        state,
        ce.effectId,
        getCardDefinitionById
      )
    )
    .filter((info): info is GrantedEffectDisplayInfo => info !== null);
}

export function getCurrentEffectDisplaysForCard(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GrantedEffectDisplayInfo[] {
  return [
    ...getGrantedEffectsForCard(state, card, def, getCardDefinitionById),
    ...getProvidedEffectsForCard(state, card, def, getCardDefinitionById),
  ];
}
