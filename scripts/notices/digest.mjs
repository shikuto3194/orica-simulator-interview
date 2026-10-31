import { execFileSync } from "node:child_process";
import { changedCardContexts } from "./card-context.mjs";

export const SHA = /^[0-9a-f]{40}$/;
export async function fetchRevision(url) {
  // /healthz is an exact route in the production API: keep its URL unchanged.
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(15_000),
    headers: { "cache-control": "no-cache" },
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Deployment check failed (${response.status})`);
  const data = await response.json();
  if (!SHA.test(data.revision)) throw new Error("Missing deployment revision");
  return data.revision;
}
export function previousJstDay(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000 - 86400_000)
    .toISOString()
    .slice(0, 10);
}
export function dayBounds(day) {
  const start = new Date(`${day}T00:00:00+09:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(start.getTime()) ||
    previousJstDay(new Date(start.getTime() + 86400_000)) !== day
  )
    throw new Error("Invalid day");
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 86400_000).toISOString(),
  };
}
export function git(root, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return execFileSync("git", args, {
    cwd: root,
    env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}
export function isPublicChange(file) {
  return (
    /^(apps\/playground-web\/((src|server|public)\/|index\.html$)|packages\/(rules-core|card-data)\/src\/|supabase\/migrations\/[^/]+\.sql$|(?:images|sounds)\/)/.test(
      file
    ) &&
    !/(^|\/)(test|fixtures|__tests__)\/|\.(test|spec)\.|\/scenario[^/]*|\/development\.|\/qa-data\.|\/training[^/]*|\/generated-index\./.test(
      file
    )
  );
}
export function isAncestor(root, before, after) {
  try {
    git(root, ["merge-base", "--is-ancestor", before, after]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}
export function collectEvidence(root, base, revision, day) {
  if (
    ![base, revision].every((value) => SHA.test(value)) ||
    !isAncestor(root, base, revision)
  )
    throw new Error("Invalid or regressed release range");
  const files = git(root, ["diff", "--name-only", "-z", base, revision])
    .split("\0")
    .filter(isPublicChange);
  if (!files.length) return { day, base, revision, commits: [], netPatch: "" };
  const commits = git(root, [
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H%x09%s",
    `${base}..${revision}`,
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subject] = line.split("\t");
      const changed = git(root, ["diff", "--name-only", "-z", `${sha}^`, sha])
        .split("\0")
        .filter((file) => files.includes(file));
      return { sha, subject: subject.join("\t"), files: changed };
    })
    .filter((commit) => commit.files.length);
  // Bound each Windows command line while retaining every file and full hunk.
  const patches = [];
  for (let index = 0; index < files.length; index += 50) {
    patches.push(
      git(root, [
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-ext-diff",
        "--no-renames",
        "--unified=5",
        base,
        revision,
        "--",
        ...files.slice(index, index + 50),
      ])
    );
  }
  const netPatch = patches.filter(Boolean).join("\n");
  const requiredMigrations = files
    .filter((file) => file.startsWith("supabase/migrations/"))
    .map((file) => file.split("/").at(-1).split("_")[0]);
  const cardContexts = files
    .filter((file) => /^packages\/card-data\/src\/cards\/.*\.ts$/.test(file))
    .flatMap((file) => {
      const sourceAt = (ref) => {
        if (!git(root, ["ls-tree", "--name-only", ref, "--", file])) return "";
        return git(root, ["show", `${ref}:${file}`]);
      };
      return changedCardContexts(file, sourceAt(base), sourceAt(revision));
    });
  const evidence = {
    day,
    base,
    revision,
    commits,
    netPatch,
    requiredMigrations,
    cardContexts,
  };
  if (Buffer.byteLength(JSON.stringify(evidence)) > 4 * 1024 * 1024)
    throw new Error("Digest evidence too large; refusing to truncate");
  return evidence;
}
const text = { type: "string" };
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const array = (items) => ({ type: "array", items });
export const summarySchema = object({
  introduction: text,
  items: array(
    object({
      title: text,
      body: text,
      sources: array(object({ commit: text, path: text, quote: text })),
    })
  ),
  omitted: array(object({ commit: text, reason: text })),
});
export const reviewSchema = object({
  approved: { type: "boolean" },
  reason: text,
  introduction: text,
  introductionSupported: { type: "boolean" },
  items: array(
    object({
      index: { type: "integer" },
      title: text,
      titleSupported: { type: "boolean" },
      claims: array(
        object({
          text,
          subject: text,
          timing: text,
          action: text,
          conditions: text,
          before: text,
          after: text,
          supported: { type: "boolean" },
          sources: array(object({ path: text, quote: text })),
        })
      ),
    })
  ),
});

function evidenceByPath(evidence) {
  const sources = new Map(
    evidence.netPatch
      .split(/(?=^diff --git )/m)
      .map((patch) => [
        /^diff --git a\/(.*?) b\/\1\r?\n/.exec(patch)?.[1],
        patch,
      ])
  );
  for (const context of evidence.cardContexts ?? []) {
    sources.set(
      context.path,
      `${sources.get(context.path) ?? ""}\n${context.before}\n${context.after}`
    );
  }
  return sources;
}

export function validateReview(review, summary, evidence) {
  const fail = () => {
    throw new Error("Digest review rejected; publication deferred");
  };
  if (
    !review ||
    review.approved !== true ||
    !review.reason?.trim() ||
    review.introduction !== summary.introduction ||
    review.introductionSupported !== true ||
    !Array.isArray(review.items) ||
    review.items.length !== summary.items.length
  )
    fail();
  const sources = evidenceByPath(evidence);
  const seen = new Set();
  for (const item of review.items) {
    const original = summary.items[item.index];
    if (
      !Number.isInteger(item.index) ||
      !original ||
      seen.has(item.index) ||
      item.title !== original.title ||
      item.titleSupported !== true ||
      !Array.isArray(item.claims) ||
      !item.claims.length ||
      item.claims.map((claim) => claim.text).join("") !== original.body
    )
      fail();
    seen.add(item.index);
    for (const claim of item.claims) {
      if (
        claim.supported !== true ||
        [
          "text",
          "subject",
          "timing",
          "action",
          "conditions",
          "before",
          "after",
        ].some((key) => typeof claim[key] !== "string" || !claim[key].trim()) ||
        !Array.isArray(claim.sources) ||
        !claim.sources.length
      )
        fail();
      for (const source of claim.sources) {
        if (
          typeof source.quote !== "string" ||
          source.quote.length < 12 ||
          !original.sources.some((s) => s.path === source.path) ||
          !sources.get(source.path)?.includes(source.quote)
        )
          fail();
      }
    }
  }
}

export function validateSummary(summary, evidence) {
  const bounded = (value, max) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[<>]|https?:\/\//i.test(value) &&
    ![...value].some((char) => char.charCodeAt(0) < 9);
  if (
    !summary ||
    !Array.isArray(summary.items) ||
    summary.items.length > 20 ||
    !Array.isArray(summary.omitted) ||
    (summary.items.length && !bounded(summary.introduction, 400))
  )
    throw new Error("Invalid digest summary");
  const commits = new Map(
    evidence.commits.map((commit) => [commit.sha, commit])
  );
  const covered = new Set();
  const patches = new Map(
    evidence.netPatch
      .split(/(?=^diff --git )/m)
      .map((patch) => [
        /^diff --git a\/(.*?) b\/\1\r?\n/.exec(patch)?.[1],
        patch,
      ])
  );
  for (const item of summary.items) {
    if (
      !bounded(item.title, 100) ||
      !bounded(item.body, 600) ||
      !Array.isArray(item.sources) ||
      !item.sources.length
    )
      throw new Error("Invalid notice item");
    for (const source of item.sources) {
      if (
        !commits.get(source.commit)?.files.includes(source.path) ||
        typeof source.quote !== "string" ||
        source.quote.length < 12 ||
        !patches.get(source.path)?.includes(source.quote)
      )
        throw new Error("Unsupported notice claim");
      covered.add(source.commit);
    }
  }
  for (const item of summary.omitted) {
    if (!commits.has(item.commit) || !bounded(item.reason, 400))
      throw new Error("Invalid omitted change");
    covered.add(item.commit);
  }
  if ([...commits.keys()].some((sha) => !covered.has(sha)))
    throw new Error("Unaccounted commit");
  if (!summary.items.length) return null;
  const [, month, date] = evidence.day.split("-");
  return {
    title: `${Number(month)}月${Number(date)}日の更新のお知らせ`,
    introduction: summary.introduction,
    items: summary.items.map(({ title, body }) => ({ title, body })),
  };
}

export async function runDigest({
  now = new Date(),
  state,
  deployed,
  resolveRange,
  summarize,
  review,
  complete,
  verifyMigrations = async (versions) => {
    if (versions.length)
      throw new Error("Database deployment verification is required");
  },
}) {
  const day = previousJstDay(now);
  if (state.last_day && state.last_day >= day)
    return { status: "already-completed", day };
  const releases = await deployed();
  if (!SHA.test(releases.frontend) || !SHA.test(releases.api))
    throw new Error("Unverified deployment");
  const evidence = await resolveRange({ day, state, releases });
  await verifyMigrations(evidence.requiredMigrations || []);
  const summary = evidence.commits.length
    ? await summarize(evidence)
    : { introduction: "", items: [], omitted: [] };
  const notice = validateSummary(summary, evidence);
  const reviewed = evidence.commits.length
    ? await review(evidence, summary)
    : null;
  if (evidence.commits.length) validateReview(reviewed, summary, evidence);
  // A rollback while generating must not announce a fix no longer deployed.
  await deployed(releases);
  await verifyMigrations(evidence.requiredMigrations || []);
  const saved = await complete({
    p_expected_day: state.last_day,
    p_expected_revision: state.through_revision,
    p_day: day,
    p_revision: evidence.revision,
    p_notice: notice,
    p_evidence: {
      base: evidence.base,
      revision: evidence.revision,
      releases,
      summary,
      review: reviewed,
    },
  });
  return {
    status: saved ? (notice ? "published" : "empty") : "already-completed",
    day,
    notice,
  };
}
