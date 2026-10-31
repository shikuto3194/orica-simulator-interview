import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  noticeEditorProfile,
  receptionProfile,
  routineReceptionKind,
} from "./auxiliary-model-policy.mjs";
import {
  pinReceptionProfile,
  routineReceptionPrompt,
} from "./telegram-reception-policy.mjs";

const root = mkdtempSync(join(tmpdir(), "orica-model-policy-"));
const inbox = join(root, "logs/codex-telegram-inbox");
const item = (id, rawText, extra = {}) => ({
  id,
  kind: "instruction",
  risk: "normal",
  rawText,
  ...extra,
});
try {
  assert.deepEqual(noticeEditorProfile("summary"), {
    model: "gpt-6-luna",
    reasoningEffort: "high",
  });
  assert.deepEqual(noticeEditorProfile("review"), {
    model: "gpt-6.1-sol",
    reasoningEffort: "xhigh",
  });
  assert.throws(() => noticeEditorProfile("unknown"));
  for (const text of [
    "フルランの状況",
    "フルランの進捗は？",
    "現在のフルランの状況",
    "フルランの状態を教えてください。",
  ])
    assert.equal(routineReceptionKind(item("1", text)), "status");
  assert.equal(
    routineReceptionKind(item("1", "Telegramのコマンド一覧を教えて")),
    "help"
  );
  for (const candidate of [
    item("1", "フルランの状況\n失敗した部分を修正して"),
    item("1", "「フルランの状況」と言ったが実装をして"),
    item("1", "それで進めて"),
    item("1", "/ruling BSAZ01-C12 裁定"),
    item("1", "フルランの状況", { kind: "ruling" }),
    item("1", "フルランの状況", { risk: "high" }),
    item("1", "フルランの状況", { priority: "force" }),
    item("1", "フルランの状況", { attachments: [{ kind: "document" }] }),
  ])
    assert.equal(routineReceptionKind(candidate), null);
  assert.deepEqual(receptionProfile(item("1", "裁定を確認"), {}), {
    kind: "general",
    model: "gpt-5.6-terra",
    reasoningEffort: "xhigh",
  });
  const status = item("1", "フルランの状況");
  const pinned = pinReceptionProfile(root, status, {});
  assert.equal(pinned.model, "gpt-6-luna");
  assert.deepEqual(
    pinReceptionProfile(root, status, { ORICA_CODEX_MODEL: "gpt-6.1-sol" }),
    pinned
  );
  assert.throws(
    () => pinReceptionProfile(root, { ...status, rawText: "実装修正" }),
    /changed or invalid/
  );
  const general = item("2", "裁定を確認");
  const original = pinReceptionProfile(root, general, {
    ORICA_CODEX_MODEL: "existing-model",
    ORICA_CODEX_REASONING_EFFORT: "high",
  });
  assert.deepEqual(pinReceptionProfile(root, general, {}), original);
  // Migrated interrupted work keeps the actual runner's receipt, not the new default.
  writeFileSync(
    join(inbox, "reception-3.json"),
    JSON.stringify({ model: "old-model", reasoningEffort: "medium" })
  );
  assert.equal(
    pinReceptionProfile(root, item("3", "フルランの状況"), {}).model,
    "old-model"
  );
  mkdirSync(join(inbox, "reception-attempts"));
  writeFileSync(join(inbox, "reception-attempts/4.json"), "{}");
  assert.throws(
    () => pinReceptionProfile(root, item("4", "フルランの状況"), {}),
    /no model receipt/
  );
  writeFileSync(join(inbox, "reception-models/5.json"), "{}");
  assert.throws(
    () => pinReceptionProfile(root, item("5", "フルランの状況"), {}),
    /changed or invalid/
  );
  assert.throws(
    () => pinReceptionProfile(root, item("../escape", "フルランの状況"), {}),
    /Invalid/
  );
  let prompt = routineReceptionPrompt(root, status, pinned);
  assert.match(prompt, /"unavailable":true/);
  writeFileSync(
    join(root, "logs/codex-supervisor-state.json"),
    JSON.stringify({
      status: "running",
      updatedAt: "2026-10-23T00:00:00Z",
      finalText: "PRIVATE_HISTORY",
      exitCode: { arbitrary: "PRIVATE_OBJECT" },
    })
  );
  prompt = routineReceptionPrompt(root, status, pinned);
  assert.match(prompt, /2026-10-23T00:00:00Z/);
  assert.match(prompt, /実プロセス生存/);
  assert(!prompt.includes("PRIVATE_"));
  assert.match(
    routineReceptionPrompt(root, item("6", "使えるコマンド一覧"), {
      kind: "help",
    }),
    /\/retry/
  );
  console.log(
    "[test-auxiliary-model-policy] passed: bounded routing, fixed retry model, legacy receipts, minimal context"
  );
} finally {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert(basename(root).startsWith("orica-model-policy-"));
  rmSync(root, { recursive: true, force: true });
}
