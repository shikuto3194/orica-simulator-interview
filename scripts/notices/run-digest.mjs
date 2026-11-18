import { createClient } from "@supabase/supabase-js";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
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
if (preview) dayBounds(preview);
const directory = join(
  root,
  preview ? "artifacts/notices/preview" : "artifacts/notices",
  day
);
const editor = createEditor(codex, directory, root);

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
  const db = createClient("https://your-production-project-ref.supabase.co", key, {
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
        fetchRevision("https://your-host.example.ts.net/healthz"),
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
      const { base, revision, catchUp } = publishedPushRange(root, {
        day: sourceDay,
        state: current,
        releases,
        activities,
        catchUp:
          current.last_day != null &&
          Date.parse(dayBounds(sourceDay).start) -
            Date.parse(dayBounds(current.last_day).start) >
            86_400_000,
      });
      const evidence = collectEvidence(root, base, revision, sourceDay);
      return catchUp ? { ...evidence, catchUp: true } : evidence;
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
  await rm(join(directory, "failure.json"), { force: true });
  console.log(JSON.stringify(result));
}
main().catch(async (error) => {
  console.error(`[operation-notices] ${error.message}`);
  process.exitCode = 1;
  const stage = error.message.includes("Public release passed the day boundary")
    ? "deployment-boundary"
    : /Unsupported notice claim|Unaccounted commit|Invalid omitted change|Invalid notice item|Invalid digest summary/.test(
          error.message
        )
      ? "draft-source-validation"
      : error.message.includes("Digest review rejected")
        ? "independent-review"
        : "runner";
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "failure.json"),
      JSON.stringify({ at: new Date().toISOString(), day, stage }, null, 2)
    );
  } catch (diagnosticError) {
    console.error(
      "[operation-notices] Could not save runner failure status",
      diagnosticError.code
    );
  }
});
