// This policy never changes the supervisor or its independent verifier.
const light = Object.freeze({ model: "gpt-6-luna", reasoningEffort: "high" });
const review = Object.freeze({
  model: "gpt-6.1-sol",
  reasoningEffort: "xhigh",
});

export function noticeEditorProfile(stage) {
  if (stage === "summary") return light;
  if (stage === "review") return review;
  throw new Error(`Unknown notice editor stage: ${stage}`);
}

export function routineReceptionKind(item) {
  if (
    item.kind !== "instruction" ||
    item.risk === "high" ||
    item.attachments?.length ||
    item.priority === "force"
  )
    return null;
  const text = String(item.rawText ?? item.text ?? "").trim();
  // Whole-message allowlist; ambiguous follow-ups and quoted requests stay general.
  if (
    /^(?:フルランの(?:状況|進捗|状態)(?:は|を教えて|を教えてください)?|現在のフルランの状況)(?:[?？。])?$/.test(
      text
    )
  )
    return "status";
  if (
    /^(?:Telegramのコマンド一覧|使えるコマンド一覧)(?:を教えて|を教えてください)?(?:[?？。])?$/.test(
      text
    )
  )
    return "help";
  return null;
}

export function receptionProfile(item, env = process.env) {
  const kind = routineReceptionKind(item);
  return kind
    ? { kind, ...light }
    : {
        kind: "general",
        model: env.ORICA_CODEX_MODEL || "gpt-5.6-terra",
        reasoningEffort: env.ORICA_CODEX_REASONING_EFFORT || "xhigh",
      };
}
