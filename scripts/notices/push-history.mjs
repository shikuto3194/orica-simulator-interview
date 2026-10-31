import { execFileSync } from "node:child_process";
import { URL } from "node:url";
import { SHA, dayBounds, git, isAncestor, isPublicChange } from "./digest.mjs";

const route = "/repos/shikuto3194/orica-simulator/activity";

// The activity API records the push time even for fast-forwarded old commits.
// Follow its cursor only until the required boundary, without truncating gaps.
export function readMainActivities(root, oldestBoundary) {
  let endpoint = `${route}?ref=refs%2Fheads%2Fmain&per_page=100`;
  const activities = [];
  for (let page = 0; page < 100; page++) {
    const response = execFileSync(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "--include",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        endpoint,
      ],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      }
    );
    const boundary = /\r?\n\r?\n/.exec(response);
    if (!boundary) throw new Error("Invalid GitHub activity response");
    const headers = response.slice(0, boundary.index);
    const rows = JSON.parse(
      response.slice(boundary.index + boundary[0].length)
    );
    if (!Array.isArray(rows)) throw new Error("Invalid GitHub activities");
    activities.push(
      ...rows.map(({ before, after, ref, timestamp, activity_type }) => ({
        before,
        after,
        ref,
        timestamp,
        activity_type,
      }))
    );
    if (
      activities.some(
        (item) => Date.parse(item.timestamp) < Date.parse(oldestBoundary)
      )
    )
      return activities;
    const next = /<([^>]+)>; rel="next"/.exec(headers)?.[1];
    if (!next) return activities;
    const url = new URL(next);
    if (
      url.origin !== "https://api.github.com" ||
      ![route, "/repositories/1261383976/activity"].includes(url.pathname)
    )
      throw new Error("Unexpected activity pagination destination");
    endpoint = url.pathname + url.search;
  }
  throw new Error("Push history boundary not reached; publication deferred");
}

export function revisionAtPushBoundary(activities, mainHead, cutoff) {
  let expected = mainHead;
  let previousTime = Infinity;
  let previousActivity;
  const end = Date.parse(cutoff);
  for (const activity of activities) {
    const identity = JSON.stringify(activity);
    // GitHub can return the same activity twice (also observed in this repo).
    if (identity === previousActivity) continue;
    previousActivity = identity;
    const time = Date.parse(activity.timestamp);
    if (
      activity.ref !== "refs/heads/main" ||
      !SHA.test(activity.before) ||
      !SHA.test(activity.after) ||
      activity.after !== expected ||
      !Number.isFinite(time) ||
      time > previousTime ||
      !["push", "pr_merge", "merge_queue_merge"].includes(
        activity.activity_type
      )
    )
      throw new Error(
        "Incomplete or rewritten main push history; publication deferred"
      );
    if (time < end) return activity.after;
    expected = activity.before;
    previousTime = time;
  }
  throw new Error("Push history boundary not reached; publication deferred");
}

export function publishedPushRange(root, { day, state, releases, activities }) {
  const mainHead = git(root, ["rev-parse", "origin/main"]);
  const cutoff = revisionAtPushBoundary(
    activities,
    mainHead,
    dayBounds(day).end
  );
  // A new-day deployment could revert yesterday's changes. Defer the whole
  // unannounced range instead of announcing a historical, no-longer-live state.
  const boundedReleases = [releases.frontend, releases.api].map((sha) => {
    if (isAncestor(root, sha, cutoff)) return sha;
    if (
      isAncestor(root, cutoff, sha) &&
      !git(root, ["diff", "--no-renames", "--name-only", "-z", cutoff, sha])
        .split("\0")
        .some(isPublicChange)
    )
      return cutoff;
    throw new Error(
      "Public release passed the day boundary; carry changes to the next digest"
    );
  });
  const revision = git(root, ["merge-base", ...boundedReleases]);
  const base =
    state.through_revision ||
    revisionAtPushBoundary(
      activities,
      mainHead,
      dayBounds(state.start_day).start
    );
  if (!isAncestor(root, base, revision))
    throw new Error(
      "Public release behind digest baseline; retry after deployment"
    );
  return { base, revision };
}
