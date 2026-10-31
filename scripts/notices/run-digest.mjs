import { createClient } from "@supabase/supabase-js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createEditor } from "./codex-summary.mjs";
import { resolveNoticeCodex } from "./codex-executable.mjs";
import {
  readMainActivities,
  revisionAtPushBoundary,
  publishedPushRange,
} from "./push-history.mjs";
import {
  fetchRevision,
  git,
  isAncestor,
  dayBounds,
  previousJstDay,
  collectEvidence,
  runDigest,
  validateSummary,
} from "./digest.mjs";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const root = resolve(
  value("--root") || fileURLToPath(new URL("../../", import.meta.url))
);
const codex = resolveNoticeCodex({ executable: value("--codex") });
const preview = value("--preview-day");
const day = preview || previousJstDay();
const directory = join(root, "artifacts/notices", day);
const editor = createEditor(codex, directory);

async function main() {
  if (preview) {
    const { start, end } = dayBounds(preview);
    git(root, ["fetch", "origin", "main"]);
    const mainHead = git(root, ["rev-parse", "origin/main"]);
    const activities = readMainActivities(root, start);
    const evidence = collectEvidence(
      root,
      revisionAtPushBoundary(activities, mainHead, start),
      revisionAtPushBoundary(activities, mainHead, end),
      preview
    );
    const summary = evidence.commits.length
      ? await editor.summarize(evidence)
      : { introduction: "", items: [], omitted: [] };
    const notice = validateSummary(summary, evidence);
    const review = evidence.commits.length
      ? await editor.review(evidence, summary)
      : { approved: true };
    console.log(
      JSON.stringify(
        {
          preview: true,
          day,
          commits: evidence.commits.length,
          notice,
          review,
        },
        null,
        2
      )
    );
    return;
  }
  const fileEnv = parseEnv(
    await readFile(join(root, "apps/playground-web/.env"), "utf8")
  );
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing notice publisher credential");
  const db = createClient("https://nnthvbizvqpufpfkzlho.supabase.co", key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: state, error } = await db
    .from("operation_notice_digest_state")
    .select("start_day,last_day,through_revision")
    .eq("singleton", true)
    .single();
  if (error) throw new Error(`Cannot read digest state (${error.code})`);
  let fetched = false;
  const result = await runDigest({
    state,
    ...editor,
    async deployed(previous) {
      const [frontend, api] = await Promise.all([
        fetchRevision(
          "https://gentle-heliotrope-e31174.netlify.app/release-version.json"
        ),
        fetchRevision("https://kenshi2.tail4e104f.ts.net/healthz"),
      ]);
      if (previous && (previous.frontend !== frontend || previous.api !== api))
        throw new Error("Deployment changed during generation; retry");
      if (!fetched) {
        git(root, ["fetch", "origin", "main"]);
        fetched = true;
      }
      for (const revision of [frontend, api]) {
        if (!isAncestor(root, revision, "origin/main"))
          throw new Error("Deployment is not on main");
      }
      return { frontend, api };
    },
    resolveRange({ day: sourceDay, state: current, releases }) {
      const activities = readMainActivities(
        root,
        current.through_revision
          ? dayBounds(sourceDay).end
          : dayBounds(current.start_day).start
      );
      const { base, revision } = publishedPushRange(root, {
        day: sourceDay,
        state: current,
        releases,
        activities,
      });
      return collectEvidence(root, base, revision, sourceDay);
    },
    async verifyMigrations(versions) {
      if (!versions.length) return;
      const { data, error: migrationError } = await db.rpc(
        "operation_notice_migrations_applied",
        { p_versions: versions }
      );
      if (migrationError || data !== true)
        throw new Error(
          "Database changes are not confirmed applied; publication deferred"
        );
    },
    async complete(payload) {
      const { data, error: completeError } = await db.rpc(
        "complete_operation_notice_digest",
        payload
      );
      if (completeError)
        throw new Error(`Cannot publish digest (${completeError.code})`);
      return data;
    },
  });
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
}
main().catch((error) => {
  console.error(`[operation-notices] ${error.message}`);
  process.exitCode = 1;
});
