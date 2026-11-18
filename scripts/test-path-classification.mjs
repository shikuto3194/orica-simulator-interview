import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import manifest from "./harness/gate-manifest.json" with { type: "json" };
import {
  mergeFuzzRequired,
  requiresMergeFuzz,
  selectGates,
  selectGatePlan,
} from "./harness/gate-manifest.mjs";
import {
  classificationFindings,
  classifyPath,
  trackedPaths,
  unclassifiedPaths,
  unreferencedGates,
} from "./harness/path-classification.mjs";
import {
  enqueueFindings,
  queuePath,
  readQueue,
  resolveFindings,
} from "./harness/unclassified-queue.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const publicDisclosureLogFiles = [
  "apps/playground-web/src/components/PublicDisclosureLogView.tsx",
  "apps/playground-web/src/components/public-disclosure-log.css",
  "e2e/scenario-public-disclosure-log.spec.ts",
];
for (const profile of ["finish", "push", "merge", "ci"]) {
  for (const file of publicDisclosureLogFiles) {
    assert.deepEqual(selectGates(profile, [file]), [
      "changed-style",
      "types",
      "docs",
      "secrets",
      "build",
      "public-build",
      "public-disclosure-log-ui",
    ]);
    assert.equal(mergeFuzzRequired([file]), false);
    const mixed = selectGates(profile, [
      file,
      "apps/playground-web/src/battle.css",
    ]);
    assert.ok(!mixed.includes("vitest"));
    assert.ok(
      selectGatePlan(profile, [
        file,
        "apps/playground-web/src/battle.css",
      ]).unresolved.some(
        (entry) => entry.file === "apps/playground-web/src/battle.css"
      )
    );
    for (const gate of ["build", "public-build", "public-disclosure-log-ui"])
      assert.ok(
        mixed.includes(gate),
        `Full verification lost ${gate} for ${file}`
      );
  }
}

// Mechanical guard: every tracked path is scoped, narrowed by a path override,
// or carries a reviewed-full reason. A new unclassified path fails here.
const tracked = trackedPaths(root);
assert.deepEqual(
  unclassifiedPaths(tracked),
  [],
  "unclassified paths: add a scope or a reviewed fullScopes entry to scripts/harness/gate-manifest.json"
);
// Falsification: without the reviewed-full entries the same guard must fire.
assert.ok(
  unclassifiedPaths(tracked, { ...manifest, fullScopes: [] }).length > 0,
  "the unclassified guard cannot detect a removed review"
);
for (const entry of manifest.fullScopes) {
  assert.ok(entry.id && entry.patterns.length > 0, "fullScopes entry shape");
  assert.ok(entry.reason.length > 40, `fullScopes ${entry.id} needs a reason`);
}

// A registered check nobody can select is a verification that never runs.
assert.deepEqual(
  unreferencedGates(),
  [],
  "gate registered in gate-manifest.json but selected by no scope, list or semanticGates"
);
// Falsification: a newly registered gate that no selection can pick is found.
assert.deepEqual(
  unreferencedGates({
    ...manifest,
    gates: { ...manifest.gates, "orphan-check": { node: "x.mjs" } },
  }),
  ["orphan-check"]
);

// Classification kinds.
assert.equal(classifyPath("unknown.ts").kind, "unclassified");
assert.equal(
  classifyPath("apps/playground-web/server/brand-new-module.ts").kind,
  "reviewed-full"
);
assert.equal(
  classifyPath("packages/rules-core/src/model.ts").kind,
  "reviewed-full"
);
assert.equal(
  classifyPath("apps/playground-web/src/components/CardView.tsx").kind,
  "scoped"
);
assert.equal(classifyPath("scripts/some-new-tool.mjs").blocking, true);

// P3-170: the identity pins and the legacy fixtures are read only by vitest
// suites (every consumer is a test under test/; checked with git grep). Each has its
// own scope (a new verification must not fall back to reviewed-full), and the
// pattern does not cover a same-named file elsewhere or a different extension.
for (const fixture of [
  "packages/rules-core/test/fixtures/effect-usage-identity-pins.json",
  "packages/rules-core/test/fixtures/legacy-effect-usage/advent-keys.json",
]) {
  assert.deepEqual(
    classifyPath(fixture),
    { kind: "scoped", gates: ["vitest"], conditional: false },
    fixture
  );
}
for (const other of [
  "packages/rules-core/test/fixtures/other/effect-usage-identity-pins.json",
  "packages/rules-core/test/fixtures/effect-usage-identity-pins.json.bak",
]) {
  assert.notDeepEqual(
    classifyPath(other),
    { kind: "scoped", gates: ["vitest"], conditional: false },
    other
  );
}

// No reviewed consumer scope means the plan must block execution.
for (const profile of ["finish", "push", "merge"]) {
  for (const file of [
    "unknown.ts",
    "apps/playground-web/server/brand-new-module.ts",
  ])
    assert.ok(
      selectGatePlan(profile, [file]).unresolved.some(
        (entry) => entry.file === file
      ),
      `${file} needs a reviewed scope`
    );
}

// Findings: unclassified always; a new verification only when its path is new.
assert.deepEqual(classificationFindings(["unknown.ts"]), [
  { file: "unknown.ts", reason: "unclassified" },
]);
const newTest = "apps/playground-web/test/brand-new.test.ts";
assert.deepEqual(
  classificationFindings([newTest], () => true),
  [{ file: newTest, reason: "new-verification" }]
);
assert.deepEqual(
  classificationFindings([newTest], () => false),
  []
);
// Already narrowed by a semantic scope (new leaf unit test -> focused-vitest).
assert.deepEqual(
  classificationFindings([newTest], () => true, {
    [newTest]: ["focused-vitest"],
  }),
  []
);
// New tests in a scoped area, and new non-verification sources, need nothing.
assert.deepEqual(
  classificationFindings(
    ["packages/rules-core/test/brand-new.test.ts"],
    () => true
  ),
  []
);
assert.deepEqual(
  classificationFindings(
    ["apps/playground-web/src/components/Brand.tsx"],
    () => true
  ),
  []
);
assert.deepEqual(
  classificationFindings(["e2e/brand-new.spec.ts"], () => true).map(
    (f) => f.reason
  ),
  ["new-verification"]
);
assert.deepEqual(classificationFindings(null), []);

// Narrow scopes introduced with evidence: media files are observed by the
// public asset contract (vitest), the build and the title e2e, nothing else.
for (const file of [
  "sounds/music/紅魔郷/track.m4a",
  "images/title/紅魔郷/background.webp",
]) {
  const picked = selectGates("finish", [file]);
  for (const id of [
    "public-assets-unit",
    "build",
    "public-build",
    "title-preparation",
  ])
    assert.ok(picked.includes(id), `${file} must run ${id}`);
  assert.ok(!picked.includes("handoff"), `${file} must not run handoff`);
}
// Only the extensions that exist and are inert; a script there keeps every gate.
for (const file of [
  "mockups/x.ts",
  "mockups/x.mjs",
  ".telegram-images/x.ts",
  "sounds/music/a/b.wav",
  "images/title/a/b.png",
])
  assert.ok(
    selectGatePlan("finish", [file]).unresolved.some(
      (entry) => entry.file === file
    ),
    `${file} needs a reviewed scope`
  );
assert.deepEqual(
  classificationFindings(
    ["supabase/tests/a.sql", "x/__tests__/a.ts"],
    () => true
  ).map((f) => f.reason),
  ["new-verification", "unclassified"]
);
assert.deepEqual(selectGates("finish", ["mockups/a.html"]), [
  "changed-style",
  "format",
]);

// Queue: appended once per open finding, closed by a resolve event.
const repo = mkdtempSync(join(tmpdir(), "classification-queue-"));
try {
  execFileSync("git", ["-C", repo, "init", "-q"], { windowsHide: true });
  execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ],
    { windowsHide: true }
  );
  const finding = { file: "unknown.ts", reason: "unclassified" };
  assert.equal(enqueueFindings(repo, [finding]).length, 1);
  assert.equal(enqueueFindings(repo, [finding]).length, 0, "duplicate queued");
  const open = readQueue(queuePath(repo)).filter((e) => e.status === "open");
  assert.equal(open.length, 1);
  assert.ok(open[0].detectedAt && open[0].branch && open[0].commit);
  assert.equal(resolveFindings(repo, ["unknown.ts"]).length, 1);
  assert.equal(
    readQueue(queuePath(repo)).filter((e) => e.status === "open").length,
    0
  );
  assert.equal(enqueueFindings(repo, [finding]).length, 1, "reopened");
} finally {
  rmSync(repo, { recursive: true, force: true });
}

// P2-16 lane ledgers. Measured by corrupting each file and running the gates
// (確度B): only effect-debug read the real registry among the script gates, and
// the one vitest file that reads it is CLUSTER_REGISTRY_TEST.
{
  const { semanticScope, CLUSTER_REGISTRY_TEST, pathOverride } =
    await import("./harness/semantic-scope.mjs");
  const registry = "autorun-queue/cluster-registry.json";
  assert.deepEqual(classifyPath(registry), {
    kind: "override",
    gates: ["docs", "effect-debug", "focused-vitest"],
  });
  const scope = semanticScope(root, [registry], ["HEAD"]);
  assert.deepEqual(scope.overrides[registry], [
    "docs",
    "effect-debug",
    "focused-vitest",
  ]);
  assert.deepEqual(scope.tests, [CLUSTER_REGISTRY_TEST]);
  for (const file of [
    "autorun-queue/needs-dsl.audit.jsonl",
    "autorun-queue/needs-dsl.w1.jsonl",
    "autorun-queue/needs-dsl.codex.jsonl",
    "autorun-queue/needs-ruling.codex.jsonl",
  ])
    assert.deepEqual(classifyPath(file), { kind: "override", gates: ["docs"] });
  // Near paths keep the full fallback: assignments are checked by prettier, the
  // root ruling queue has its own semantic scope, and an unreviewed queue file
  // or a nested/renamed copy is not covered by the review.
  for (const file of [
    "autorun-assignments.json",
    "needs-ruling.jsonl",
    "autorun-queue/needs-ruling.jsonl",
    "autorun-queue/needs-dsl.new.json",
    "autorun-queue/needs-dsl.audit.jsonl.bak",
    "autorun-queue/sub/needs-dsl.audit.jsonl",
    "autorun-queue/cluster-registry.json.bak",
  ]) {
    assert.equal(pathOverride(file), undefined, file);
    assert.equal(classifyPath(file).kind, "reviewed-full", file);
  }
  assert.deepEqual(classifyPath("autorun-queue/README.md"), {
    kind: "scoped",
    gates: ["docs"],
    conditional: false,
  });
  assert.ok(
    selectGatePlan("merge", ["autorun-assignments.json"]).unresolved.length,
    "autorun-assignments.json requires a registered scope"
  );
}

// P2-16 static inputs. Measured by breaking 684 files and running the 29 full
// gates twice (content break; delete): only format/lint/vitest, then docs, moved.
// A groupwise vitest run then showed images, deploy/oracle and the manual assets
// (665 files) leave all 22436 tests unchanged; only the SQL moved eight suites.
{
  const {
    pathOverride,
    pathOverrideTests,
    semanticScope,
    STATIC_INPUT_GATES,
    SQL_INPUT_GATES,
    SQL_INPUT_TESTS,
    STATIC_INPUT_PATTERNS,
  } = await import("./harness/semantic-scope.mjs");
  const picked = ["format", "lint", "docs", "secrets"];
  // Deleting the card images made build and public-build fail (assertPublicCardImages).
  const imagePicked = [...picked, "build", "public-build"];
  const sqlPicked = [...picked, "focused-vitest"];
  assert.deepEqual(STATIC_INPUT_GATES, picked);
  assert.deepEqual(SQL_INPUT_GATES, sqlPicked);
  assert.deepEqual(classifyPath("images/BSAZ01-C01.webp"), {
    kind: "override",
    gates: imagePicked,
  });
  for (const file of [
    "supabase/migrations/009_commit_room_state_rpc.sql",
    "supabase/tests/fixtures/bs-account-links.sql",
    "supabase/migrations/20270101000000_future.sql",
  ])
    assert.deepEqual(classifyPath(file), {
      kind: "override",
      gates: sqlPicked,
    });
  for (const file of [
    "deploy/oracle/Caddyfile",
    "deploy/oracle/deploy-api.sh",
    "deploy/oracle/orica-api.service",
    "deploy/oracle/api.env.example",
    "manual/_legacy/dsl-v2-design/dsl-v2.ts",
    "manual/ai-reference/25_gui/mockups/home-lobby.html",
    "manual/ai-reference/25_gui/mockups/assets/night.webp",
    "manual/ai-reference/25_gui/mockups/assets/lucide-license.txt",
    "manual/ai-reference/30_plan/2026-09-10-effect-result-wording-audit.json",
    "qa/rest-rebirth-post-choice.ts",
  ])
    assert.deepEqual(classifyPath(file), { kind: "override", gates: picked });
  // Every tracked file the patterns cover gets exactly this set, and the
  // patterns still match the files that were mutated (a renamed directory would
  // otherwise silently drop out of the measured population).
  const tracked = trackedPaths(root);
  const covered = tracked.filter((file) =>
    STATIC_INPUT_PATTERNS.some((p) => p.test(file))
  );
  assert.ok(covered.length >= 684, `covered ${covered.length} < 684`);
  // The population is evidence-bound: adding or widening a pattern extends
  // what skips vitest and the merge fuzz, so it must come with a new mutation
  // experiment and a deliberate edit of this list (a count would break on every
  // card image added, so the sources are pinned instead).
  assert.deepEqual(
    STATIC_INPUT_PATTERNS.map(String),
    [
      /^supabase\/migrations\/[^/]+\.sql$/,
      /^supabase\/tests\/fixtures\/[^/]+\.sql$/,
      /^images\/[^/]+\.webp$/,
      /^deploy\/oracle\/(?:Caddyfile|[^/]+\.(?:sh|service|example))$/,
      /^manual\/_legacy\/dsl-v2-design\/[^/]+\.ts$/,
      /^manual\/ai-reference\/25_gui\/mockups\/(?:home-lobby\.html|assets\/[^/]+\.(?:webp|txt))$/,
      /^manual\/ai-reference\/30_plan\/2026-09-10-effect-result-wording-audit\.json$/,
      /^qa\/rest-rebirth-post-choice\.ts$/,
    ].map(String),
    "STATIC_INPUT_PATTERNS changed without a new experiment"
  );
  for (const file of covered)
    assert.deepEqual(
      pathOverride(file),
      /^images\//.test(file)
        ? imagePicked
        : /^supabase\//.test(file)
          ? sqlPicked
          : picked,
      file
    );
  // Each pattern must still reach a measured file, so a moved directory cannot
  // leave a pattern matching nothing.
  for (const pattern of STATIC_INPUT_PATTERNS)
    assert.ok(
      tracked.some((file) => pattern.test(file)),
      `${pattern} matches no tracked file`
    );
  // The integrated selection (semanticScope) hands the same override out.
  const migration = "supabase/migrations/009_commit_room_state_rpc.sql";
  const sqlScope = semanticScope(root, [migration], ["HEAD"]);
  assert.deepEqual(sqlScope.overrides[migration], sqlPicked);
  // The focused suites are exactly the eight that executed the SQL in the
  // break/delete experiments, they exist, and every SQL file maps to them.
  assert.deepEqual(sqlScope.tests, SQL_INPUT_TESTS);
  assert.equal(SQL_INPUT_TESTS.length, 8);
  for (const test of SQL_INPUT_TESTS)
    assert.ok(tracked.includes(test), `${test} is not a known file`);
  // Completeness guard: the list is typed in, so it must not drift from the
  // tests that actually name the SQL. Every vitest-included test that names
  // supabase/{migrations,tests} is either listed or the one known temp-folder
  // fixture (operation-notice-digest writes its own SQL; the break/delete
  // experiments left it unchanged), and every listed suite names the SQL.
  // Static name matching only (確度B): a reader that builds the path elsewhere
  // would not be seen here.
  // Scope: every ts/tsx/mjs file under any test/ directory of apps/ and
  // packages/ (a superset of vitest.config.ts include, helpers included). A
  // helper that names the SQL fails the equality below and forces a review.
  const vitestTree = tracked.filter(
    (file) =>
      /^(?:apps|packages)\/(?:.+\/)?test\/.*\.(?:ts|tsx|mjs)$/.test(file) &&
      existsSync(resolve(root, file))
  );
  const sourceOf = new Map(
    vitestTree.map((file) => [file, readFileSync(resolve(root, file), "utf8")])
  );
  const naming = (pattern) =>
    vitestTree.filter((file) => pattern.test(sourceOf.get(file)));
  const sqlNamed = /supabase\/(?:migrations|tests)\b/;
  const TEMP_FIXTURE_READERS = [
    "apps/playground-web/test/operation-notice-digest.test.ts",
  ];
  const namingTests = naming(sqlNamed);
  assert.deepEqual(
    namingTests.filter((file) => !TEMP_FIXTURE_READERS.includes(file)).sort(),
    [...SQL_INPUT_TESTS].sort(),
    "a vitest suite names the SQL but is not in SQL_INPUT_TESTS (or the reverse)"
  );
  for (const file of TEMP_FIXTURE_READERS)
    assert.ok(namingTests.includes(file), `${file} no longer names the SQL`);
  // The other groups run no vitest, so no vitest file may read them. deploy/
  // oracle, qa, manual/_legacy and the mockup/audit files are never named. Card
  // images are named as URL strings by a few suites, so the guard is a file
  // that both names a top-level images/*.webp and reads files; the one known
  // reader builds its images in a temp folder (the experiments left it
  // unchanged). Static name matching only (確度B).
  assert.deepEqual(
    naming(
      /deploy\/oracle|rest-rebirth-post-choice|_legacy\/dsl-v2-design|25_gui\/mockups|effect-result-wording-audit/
    ),
    [],
    "a vitest file names a path whose group runs no vitest"
  );
  assert.deepEqual(
    naming(/images\/[^/"'`\s]+\.webp|"images"/).filter((file) =>
      /readFileSync|readdirSync|existsSync|statSync|readFile\(|createReadStream/.test(
        sourceOf.get(file)
      )
    ),
    TEMP_FIXTURE_READERS,
    "a vitest file reads card images from disk"
  );
  for (const file of covered)
    assert.deepEqual(
      pathOverrideTests(file),
      file.startsWith("supabase/") ? SQL_INPUT_TESTS : undefined,
      file
    );
  // Neighbours keep the full fallback: other extensions, nesting, backups,
  // sibling directories and scripts that gates import.
  for (const file of [
    "supabase/migrations/x.sql.bak",
    "supabase/migrations/sub/x.sql",
    "supabase/migrations/x.json",
    "supabase/tests/x.sql",
    "supabase/config.toml",
    "images/x.webp.bak",
    "images/x.png",
    "images/sub/x.webp",
    "images/ForGUI/card-back.jpg",
    "deploy/oracle/sub/x.conf",
    "deploy/oracle/x.mjs",
    "deploy/oracle/x.js",
    "deploy/oracle/x.conf",
    "deploy/oracle/Caddyfile.bak",
    "manual/ai-reference/25_gui/mockups/assets/x.png",
    "manual/ai-reference/25_gui/mockups/assets/x.svg",
    "manual/ai-reference/25_gui/mockups/assets/x.js",
    "deploy/local-pc/run-api.mjs",
    "manual/_legacy/dsl-v2-design/x.mjs",
    "manual/_legacy/dsl-v2-design/sub/x.ts",
    "manual/_legacy/x.ts",
    "manual/ai-reference/25_gui/mockups/home-lobby.html.bak",
    "manual/ai-reference/25_gui/mockups/assets/sub/x.webp",
    "manual/ai-reference/25_gui/mockups/other.html",
    "manual/ai-reference/30_plan/2026-09-10-effect-result-wording-audit.json.bak",
    "manual/ai-reference/30_plan/other.json",
    "qa/other.ts",
    "qa/rest-rebirth-post-choice.ts.bak",
  ]) {
    assert.equal(pathOverride(file), undefined, file);
    assert.equal(classifyPath(file).kind, "reviewed-full", file);
  }
  // Already scoped by its own consumer; the static rule must not take it over.
  assert.equal(pathOverride("deploy/local-pc/funnel-policy.mjs"), undefined);

  // The merge fuzz is exempt for exactly these groups (a 100-game run was
  // identical to the baseline under break and delete). Compare group by group.
  const fuzzFree = {
    sql: [
      "supabase/migrations/009_commit_room_state_rpc.sql",
      "supabase/tests/fixtures/bs-account-links.sql",
    ],
    images: ["images/BSAZ01-C01.webp"],
    oracle: ["deploy/oracle/Caddyfile", "deploy/oracle/deploy-api.sh"],
    manual: [
      "manual/_legacy/dsl-v2-design/dsl-v2.ts",
      "manual/ai-reference/25_gui/mockups/home-lobby.html",
      "manual/ai-reference/30_plan/2026-09-10-effect-result-wording-audit.json",
      "qa/rest-rebirth-post-choice.ts",
    ],
  };
  for (const [group, files] of Object.entries(fuzzFree)) {
    for (const file of files)
      assert.equal(requiresMergeFuzz([file]), false, `${group}: ${file}`);
    assert.equal(requiresMergeFuzz(files), false, group);
  }
  assert.equal(requiresMergeFuzz(Object.values(fuzzFree).flat()), false);
  // Every covered file, not just the samples, is exempt.
  for (const file of covered)
    assert.equal(requiresMergeFuzz([file]), false, file);
  // A neighbour of a group, a mixed change and the fuzz machinery stay required.
  for (const file of [
    "supabase/config.toml",
    "supabase/migrations/x.sql.bak",
    "images/ForGUI/card-back.jpg",
    "images/x.png",
    "deploy/oracle/x.mjs",
    "deploy/local-pc/run-api.mjs",
    "manual/_legacy/dsl-v2-design/x.mjs",
    "qa/other.ts",
    "autorun-assignments.json",
    "apps/playground-web/server/brand-new-module.ts",
    "apps/playground-web/server/sub/game-api.ts",
    "apps/playground-web/server/game-api.ts.bak",
  ])
    assert.equal(requiresMergeFuzz([file]), true, file);
  for (const file of [
    "packages/rules-core/src/runtime.ts",
    "packages/card-data/src/cards/BSAZ01.ts",
    "scripts/fuzz-runner.mjs",
    "apps/playground-web/test/selfplay-driver.ts",
    "supabase/config.toml",
  ])
    assert.equal(
      requiresMergeFuzz([...fuzzFree.sql, ...fuzzFree.images, file]),
      true,
      `a static group does not hide ${file}`
    );
  assert.equal(requiresMergeFuzz(null), true);
  assert.equal(requiresMergeFuzz([]), false);

  // The production decision (run-gates.mjs) goes through mergeFuzzRequired with
  // the overrides semanticScope hands out. The caller drops overrides without
  // `vitest`; requiresMergeFuzz independently exempts the same groups.
  const overridesFor = (files) =>
    Object.fromEntries(
      files.flatMap((file) => {
        const gates = pathOverride(file);
        return gates ? [[file, gates]] : [];
      })
    );
  const everyStatic = Object.values(fuzzFree).flat();
  assert.equal(
    mergeFuzzRequired(everyStatic, overridesFor(everyStatic)),
    false
  );
  for (const [group, files] of Object.entries(fuzzFree))
    assert.equal(mergeFuzzRequired(files, overridesFor(files)), false, group);
  for (const file of [
    "packages/rules-core/src/runtime.ts",
    "packages/card-data/src/cards/BSAZ01.ts",
    "supabase/config.toml",
    "deploy/oracle/x.mjs",
    "scripts/fuzz-runner.mjs",
  ]) {
    const files = [...fuzzFree.sql, file];
    assert.equal(
      mergeFuzzRequired(files, overridesFor(files)),
      true,
      `production path keeps the fuzz for ${file}`
    );
  }
  assert.equal(mergeFuzzRequired(null, {}), true);
}

// P2-16 server modules. Measured by corrupting and deleting all 15 files and
// running 23 gates (the 28 full gates minus format, lint, types, docs, vitest
// and secrets, plus card-tests): only ssot moved (game-api.ts). docs was
// measured on its own: a deletion breaks links to game-api.ts and api-limits.ts.
// The fuzz summary was identical. Exact paths: a new file under server/ keeps the full fallback.
{
  const {
    pathOverride,
    semanticScope,
    SERVER_STANDALONE_GATES,
    SERVER_VITE_GATES,
  } = await import("./harness/semantic-scope.mjs");
  const {
    SERVER_GAME_API,
    SERVER_STANDALONE_MODULES,
    SERVER_VITE_MODULES,
    isServerModule,
  } = await import("./harness/static-inputs.mjs");
  const dir = "apps/playground-web/server/";
  const names = (list) => list.map((file) => file.slice(dir.length, -3));
  // The population is evidence-bound: widening a list needs a new experiment.
  assert.deepEqual(names(SERVER_VITE_MODULES), [
    "api-limits",
    "game-api",
    "image-assets",
    "local-game-api",
    "local-game-session",
    "public-build",
    "release-version",
    "room-invitations",
    "room-list",
    "room-push",
    "room-retention",
    "upstream-warmth",
  ]);
  assert.deepEqual(names(SERVER_STANDALONE_MODULES), [
    "http-runtime",
    "http-server",
    "main",
  ]);
  assert.equal(SERVER_GAME_API, `${dir}game-api.ts`);
  assert.deepEqual(SERVER_STANDALONE_GATES, [
    "types",
    "vitest",
    "secrets",
    "docs",
  ]);
  assert.deepEqual(SERVER_VITE_GATES, [
    "types",
    "vitest",
    "secrets",
    "docs",
    "scenario",
    "local-game-ui",
    "build",
    "public-build",
  ]);
  const tracked = trackedPaths(root);
  const serverFiles = tracked.filter((file) =>
    /^apps\/playground-web\/server\/[^/]+\.ts$/.test(file)
  );
  // Every classified module is a tracked file and nothing tracked is missed
  // silently: an unlisted server file must stay reviewed-full.
  for (const file of [...SERVER_VITE_MODULES, ...SERVER_STANDALONE_MODULES])
    assert.ok(serverFiles.includes(file), `${file} is not a tracked file`);
  for (const file of serverFiles)
    assert.equal(
      classifyPath(file).kind,
      isServerModule(file) ? "override" : "reviewed-full",
      file
    );
  for (const file of SERVER_STANDALONE_MODULES)
    assert.deepEqual(classifyPath(file), {
      kind: "override",
      gates: SERVER_STANDALONE_GATES,
    });
  for (const file of SERVER_VITE_MODULES)
    assert.deepEqual(classifyPath(file), {
      kind: "override",
      gates:
        file === SERVER_GAME_API
          ? [...SERVER_VITE_GATES, "ssot"]
          : SERVER_VITE_GATES,
    });
  // Neighbours keep the full fallback.
  for (const file of [
    `${dir}brand-new-module.ts`,
    `${dir}game-api.ts.bak`,
    `${dir}sub/game-api.ts`,
    "apps/playground-web/load-server-env.ts",
    "apps/playground-web/vite.config.ts",
  ]) {
    assert.equal(pathOverride(file), undefined, file);
    assert.equal(isServerModule(file), false, file);
  }
  // The integrated selection hands the same override out and the merge
  // selection no longer carries the 22 gates the experiment showed idle.
  const roomList = `${dir}room-list.ts`;
  assert.deepEqual(semanticScope(root, [roomList], ["HEAD"]).overrides, {
    [roomList]: [
      ...SERVER_VITE_GATES.filter((gate) => gate !== "vitest"),
      "focused-vitest",
    ],
  });
  const idle = [
    "handoff",
    "ismcts-program",
    "ismcts-runtime",
    "harness",
    "fidelity",
    "auto-merge-integration",
    "telegram",
    "supervisor-runner-lock",
    "storage",
    "effect-debug",
    "verifier",
    "ledger",
    "wiring",
    "card-tests",
  ];
  const overrides = semanticScope(root, [roomList], ["HEAD"]).overrides;
  for (const profile of ["finish", "push", "merge", "ci"]) {
    const selected = selectGates(
      profile,
      [roomList],
      () => null,
      () => false,
      [],
      overrides
    );
    assert.deepEqual(
      selected.sort(),
      ["changed-style", ...overrides[roomList]].sort(),
      profile
    );
    for (const id of idle)
      assert.ok(!selected.includes(id), `${profile}: ${id}`);
  }
  // game-api.ts is the one file ssot reads; the GUI gates stay selected.
  assert.deepEqual(
    selectGates(
      "merge",
      [SERVER_GAME_API],
      () => null,
      () => false,
      [],
      semanticScope(root, [SERVER_GAME_API], ["HEAD"]).overrides
    ).sort(),
    ["changed-style", ...overrides[roomList], "ssot"].sort()
  );
  const newServer = `${dir}brand-new-module.ts`;
  const mixed = selectGatePlan(
    "merge",
    [roomList, newServer],
    undefined,
    undefined,
    [],
    overrides
  );
  assert.deepEqual(
    mixed.unresolved.map(({ file }) => file),
    [newServer]
  );
  assert.ok(mixed.ids.includes("local-game-ui"));

  // Completeness guards on readers (static name matching only, 確度B: a path
  // built elsewhere is not seen). The experiment showed ssot read only
  // game-api.ts, so a script or deploy file that newly names the directory is a
  // possible new reader: the list is pinned and a change forces a review. The
  // harness files below only describe the paths, they do not read the modules.
  const SELF_REFERENCING = [
    "scripts/harness/gate-manifest.json",
    "scripts/harness/gate-manifest.mjs",
    "scripts/harness/static-inputs.mjs",
    "scripts/test-harness.mjs",
    "scripts/test-local-game-gates.mjs",
    "scripts/test-path-classification.mjs",
  ];
  const textOf = (file) => readFileSync(resolve(root, file), "utf8");
  const readers = tracked
    .filter(
      (file) =>
        /^(?:scripts|deploy)\//.test(file) &&
        !SELF_REFERENCING.includes(file) &&
        existsSync(resolve(root, file)) &&
        textOf(file).includes("playground-web/server")
    )
    .sort();
  assert.deepEqual(
    readers,
    [
      "deploy/local-pc/update-api.mjs",
      "scripts/build-api.mjs",
      "scripts/check-ssot.mjs",
      "scripts/gate-evidence.mjs",
    ],
    "a file newly names the server directory: check whether a gate reads it, then re-run the mutation experiment"
  );
  // The three standalone modules rest on one fact: nothing the GUI gates load
  // reaches them. Compute the relative-import closure (static and literal
  // dynamic imports, types included, so it over-approximates) from every GUI
  // entry: vite.config.ts and what it loads, the browser app, the shared
  // protocol, the e2e specs and the Playwright configs. A new importer anywhere
  // in that closure, including inside the vite-loaded server modules, would make
  // the GUI gates observe a standalone module, so it must fail here.
  // Only files that exist: a deletion still staged in the index is listed by
  // git ls-files --cached but cannot be read.
  const trackedSet = new Set(
    tracked.filter((file) => existsSync(resolve(root, file)))
  );
  const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts"];
  const resolveImport = (from, specifier) => {
    const base = posix
      .normalize(posix.join(posix.dirname(from), specifier))
      .replace(/\.[cm]?[jt]sx?$/, "");
    return EXTENSIONS.map((extension) => base + extension).find((candidate) =>
      trackedSet.has(candidate)
    );
  };
  const guiRoots = [...trackedSet].filter(
    (file) =>
      /^(?:e2e\/.+\.ts|playwright\.[^/]+\.ts|apps\/playground-web\/(?:src|shared)\/.+\.tsx?)$/.test(
        file
      ) ||
      file === "apps/playground-web/vite.config.ts" ||
      file === "apps/playground-web/load-server-env.ts"
  );
  assert.ok(guiRoots.length > 300, "GUI entry files are tracked");
  const reached = new Set(guiRoots);
  const unresolved = [];
  for (const queue = [...guiRoots]; queue.length; ) {
    const file = queue.pop();
    for (const { fileName } of ts.preProcessFile(textOf(file), true, true)
      .importedFiles) {
      if (!fileName.startsWith(".")) continue;
      const next = resolveImport(file, fileName);
      if (!next) unresolved.push(file + " -> " + fileName);
      else if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  // The traversal itself is checked: every relative specifier resolves (an
  // unresolvable form such as a ?query suffix or a new extension would otherwise
  // drop an edge silently) and it reaches every vite-loaded module.
  assert.deepEqual(
    unresolved,
    [],
    "an import in the GUI closure is not resolved"
  );
  for (const file of SERVER_VITE_MODULES)
    assert.ok(reached.has(file), file + " is not reached from the GUI entries");
  assert.deepEqual(
    SERVER_STANDALONE_MODULES.filter((file) => reached.has(file)),
    [],
    "the GUI entries reach a standalone server module"
  );
  // Non-TypeScript entries (workflows) are checked by name.
  assert.deepEqual(
    tracked
      .filter(
        (file) => file.startsWith(".github/") && existsSync(resolve(root, file))
      )
      .filter((file) =>
        /\b(?:http-runtime|http-server)\b|server\/main\b/.test(textOf(file))
      ),
    [],
    "a workflow names a standalone server module"
  );
  // The merge fuzz is exempt for every server module (and only these).
  for (const file of [...SERVER_VITE_MODULES, ...SERVER_STANDALONE_MODULES]) {
    assert.equal(requiresMergeFuzz([file]), false, file);
    assert.equal(
      mergeFuzzRequired([file], { [file]: pathOverride(file) }),
      false,
      file
    );
  }
  assert.equal(
    requiresMergeFuzz([...SERVER_VITE_MODULES, ...SERVER_STANDALONE_MODULES]),
    false
  );
  for (const file of [
    `${dir}brand-new-module.ts`,
    "packages/rules-core/src/runtime.ts",
    "apps/playground-web/test/selfplay-driver.ts",
    "scripts/fuzz-runner.mjs",
  ])
    assert.equal(
      requiresMergeFuzz([roomList, file]),
      true,
      `a server module does not hide ${file}`
    );
}

// P2-16 apps/playground-web src and test. Measured 2026-11-03 by corrupting and
// then deleting all 414 files (the 261 reviewed-full src files, the 145
// reviewed-full *.test.ts files and the 8 SQL suites) against an unmutated
// baseline: the heavy script gates kept their result; ssot, docs and harness
// moved, and per-group runs of those three attributed them (see
// semantic-scope.mjs). The fuzz summary was identical. Exact paths: a file
// added later keeps the full fallback, except a new leaf test, which
// semanticScope narrows to focused-vitest.
{
  const {
    pathOverride,
    semanticScope,
    PLAYGROUND_SRC_GATES,
    PLAYGROUND_TEST_GATES,
    SQL_INPUT_TESTS,
  } = await import("./harness/semantic-scope.mjs");
  const {
    E2E_SPEC_FILES,
    PLAYGROUND_SRC_FILES,
    PLAYGROUND_TEST_FILES,
    isPlaygroundSrcFile,
    isPlaygroundTestFile,
  } = await import("./harness/static-inputs.mjs");
  const tracked = trackedPaths(root);
  assert.deepEqual(PLAYGROUND_SRC_GATES, [
    "types",
    "vitest",
    "secrets",
    "docs",
    "ssot",
    "harness",
    "scenario",
    "local-game-ui",
    "build",
    "public-build",
  ]);
  assert.deepEqual(PLAYGROUND_TEST_GATES, [
    "types",
    "vitest",
    "secrets",
    "docs",
    "harness",
    "card-tests",
  ]);
  // The population is evidence-tracked: the lists are exactly the files the
  // 2026-11-03 experiments mutated (261 src, 145 tests). Adding a file needs a
  // new experiment; removing one needs the list, the counts and the digest updated together. The digest makes
  // an unmeasured addition fail until the pin is updated in the same diff (a
  // friction, not proof that an experiment was run).
  assert.equal(PLAYGROUND_SRC_FILES.length, 261);
  assert.equal(PLAYGROUND_TEST_FILES.length, 145);
  assert.equal(
    createHash("sha256")
      .update(
        [...PLAYGROUND_SRC_FILES].sort().join("\n") +
          "\n--\n" +
          [...PLAYGROUND_TEST_FILES].sort().join("\n")
      )
      .digest("hex"),
    "039837851ab9d23b2f252ba29e1406222735efca6250d868859030d94fdc37b0",
    "the measured population changed: re-run the mutation experiment for an added file"
  );
  // The population is evidence-bound: a list may only hold tracked files that
  // no manifest scope claims (an override would hide that scope) and that are
  // the kind the experiment mutated.
  assert.equal(new Set(PLAYGROUND_SRC_FILES).size, PLAYGROUND_SRC_FILES.length);
  assert.equal(
    new Set(PLAYGROUND_TEST_FILES).size,
    PLAYGROUND_TEST_FILES.length
  );
  const claimedByScope = (file) =>
    manifest.scopes.some((scope) =>
      scope.patterns.some((pattern) => new RegExp(pattern).test(file))
    );
  for (const file of PLAYGROUND_SRC_FILES) {
    assert.ok(tracked.includes(file), `${file} is not known to git`);
    // A deletion that is not staged stays in the index, so ask the disk too.
    assert.ok(existsSync(resolve(root, file)), `${file} is missing on disk`);
    assert.ok(file.startsWith("apps/playground-web/src/"), file);
    assert.equal(claimedByScope(file), false, `${file} is claimed by a scope`);
    assert.deepEqual(classifyPath(file), {
      kind: "override",
      gates: PLAYGROUND_SRC_GATES,
    });
  }
  for (const file of PLAYGROUND_TEST_FILES) {
    assert.ok(tracked.includes(file), `${file} is not known to git`);
    assert.ok(existsSync(resolve(root, file)), `${file} is missing on disk`);
    assert.ok(/^apps\/playground-web\/test\/[^/]+\.test\.ts$/.test(file), file);
    assert.ok(!SQL_INPUT_TESTS.includes(file), `${file} names the SQL`);
    assert.notEqual(file, "apps/playground-web/test/selfplay-fuzz.test.ts");
    assert.equal(claimedByScope(file), false, `${file} is claimed by a scope`);
    assert.deepEqual(classifyPath(file), {
      kind: "override",
      gates: PLAYGROUND_TEST_GATES,
    });
  }
  // Neighbours keep the full fallback: a new file, a nested file, a helper or
  // fixture, the SQL suites, and the fuzz machinery.
  const srcNeighbours = [
    "apps/playground-web/src/brand-new-module.ts",
    "apps/playground-web/src/components/brand-new-view.tsx",
    "apps/playground-web/src/App.tsx.bak",
  ];
  const testNeighbours = [
    "apps/playground-web/test/brand-new.test.ts",
    "apps/playground-web/test/selfplay-driver.ts",
    "apps/playground-web/test/fixtures/brand-new.ts",
    ...SQL_INPUT_TESTS,
  ];
  // The fuzz test keeps its own override (types only); it is not in the list.
  const fuzzTest = "apps/playground-web/test/selfplay-fuzz.test.ts";
  assert.equal(isPlaygroundTestFile(fuzzTest), false);
  assert.deepEqual(pathOverride(fuzzTest), ["types"]);
  for (const file of [...srcNeighbours, ...testNeighbours]) {
    assert.equal(isPlaygroundSrcFile(file), false, file);
    assert.equal(isPlaygroundTestFile(file), false, file);
    assert.equal(pathOverride(file), undefined, file);
  }
  for (const file of [
    "apps/playground-web/src/brand-new-module.ts",
    "apps/playground-web/test/brand-new.test.ts",
  ])
    assert.equal(classifyPath(file).kind, "reviewed-full", file);
  // The integrated selection hands the same override out; merge, finish, push
  // and ci no longer carry these gates: the ones the experiment left unchanged,
  // and card-tests for src (static reading: it lists test files only).
  const requiredScopeFree = (file) =>
    !(manifest.requiredScopes ?? []).some((scope) =>
      scope.patterns.some((pattern) => new RegExp(pattern).test(file))
    );
  const srcFile = PLAYGROUND_SRC_FILES.find(requiredScopeFree);
  const testFile = PLAYGROUND_TEST_FILES.find(requiredScopeFree);
  assert.ok(srcFile && testFile);
  assert.deepEqual(semanticScope(root, [srcFile], ["HEAD"]).overrides, {
    [srcFile]: [
      ...PLAYGROUND_SRC_GATES.filter((gate) => gate !== "vitest"),
      "focused-vitest",
    ],
  });
  const idle = [
    "handoff",
    "ismcts-program",
    "ismcts-runtime",
    "fidelity",
    "auto-merge-integration",
    "telegram",
    "supervisor-runner-lock",
    "storage",
    "effect-debug",
    "verifier",
    "ledger",
    "wiring",
    "card-tests",
  ];
  for (const [file, gates] of [
    [srcFile, PLAYGROUND_SRC_GATES],
    [testFile, PLAYGROUND_TEST_GATES],
  ])
    for (const profile of ["finish", "push", "merge", "ci"]) {
      const selected = selectGates(
        profile,
        [file],
        () => null,
        () => false,
        [],
        { [file]: pathOverride(file) }
      );
      assert.deepEqual(
        selected.sort(),
        ["changed-style", ...gates.filter((id) => id !== "vitest")].sort(),
        `${profile}: ${file}`
      );
      for (const id of idle.filter((gate) => !gates.includes(gate)))
        assert.ok(!selected.includes(id), `${profile}: ${id}`);
    }
  for (const [file, neighbour] of [
    [srcFile, srcNeighbours[0]],
    [testFile, testNeighbours[0]],
  ]) {
    const scope = semanticScope(root, [file], ["HEAD"]);
    const mixed = selectGatePlan(
      "merge",
      [file, neighbour],
      undefined,
      undefined,
      [],
      scope.overrides,
      scope.tests,
      scope.reasons
    );
    assert.ok(mixed.unresolved.some((entry) => entry.file === neighbour));
    assert.ok(mixed.ids.includes("focused-vitest"));
  }

  const PIN_MENTIONS = [
    ".gitleaks.toml",
    "README.md",
    "apps/playground-web/package.json",
    "deploy/local-pc/run-api.mjs",
    "deploy/local-pc/update-api.mjs",
    "netlify.toml",
    "package.json",
    "playwright.config.ts",
    "playwright.local.config.ts",
    "pnpm-lock.yaml",
    "scripts/audit-special-nexus-affect.mjs",
    "scripts/build-api.mjs",
    "scripts/check-ssot.mjs",
    "scripts/configure-room-push.mjs",
    "scripts/dot/README.md",
    "scripts/dot/rules-adapter.ts",
    "scripts/dot/start.mjs",
    "scripts/effect-debug-loop.mjs",
    "scripts/externalize-onedrive.ps1",
    "scripts/fuzz-runner.mjs",
    "scripts/gate-evidence.mjs",
    "scripts/generate-app-icons.mjs",
    "scripts/harness/check-dev-server-contract.mjs",
    "scripts/harness/dev-server-contract.json",
    "scripts/harness/gate-manifest.mjs",
    "scripts/harness/pre-tool-guard-core.cjs",
    "scripts/harness/room-delivery-scope.mjs",
    "scripts/harness/semantic-scope.mjs",
    "scripts/harness/verification-state.cjs",
    "scripts/new-worktree.ps1",
    "scripts/notices/digest.mjs",
    "scripts/notices/run-digest.mjs",
    "scripts/prepare-bgm-assets.mjs",
    "scripts/prepare-card-images.mjs",
    "scripts/security/test-secrets.mjs",
    "scripts/sync-orika-account-link.mjs",
    "scripts/test-audit-operations.mjs",
    "scripts/test-effect-debug-loop-state.mjs",
    "scripts/test-fidelity-review-resolution.mjs",
    "scripts/test-fuzz-runner.mjs",
    "scripts/test-harness.mjs",
    "scripts/test-ismcts-program.mjs",
    "scripts/test-local-game-gates.mjs",
    "scripts/test-semantic-scope.mjs",
    "scripts/test-verifier-gate.mjs",
    "vitest.config.ts",
  ];
  const PIN_WALKERS = [
    "scripts/card-text-accountability-audit.mjs",
    "scripts/check-card-test-coverage.mjs",
    "scripts/check-ssot.mjs",
    "scripts/gate-evidence.mjs",
    // Codex's connector feature name; this module never walks apps/.
    "scripts/notices/codex-large-input.mjs",
    "scripts/ssot-candidate-scan.mjs",
    "scripts/test-effect-debug-loop-state.mjs",
  ];
  const PIN_SRC_NAMERS = [
    "apps/playground-web/vite.config.ts",
    "autorun-queue/cluster-registry.json",
    "packages/ai/src/tools/write-advisor.ts",
    "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json",
    "scripts/check-ssot.mjs",
    "scripts/dot/rules-adapter.ts",
    "scripts/generate-app-icons.mjs",
    "scripts/harness/pre-tool-guard-core.cjs",
    "scripts/harness/room-delivery-scope.mjs",
    "scripts/harness/semantic-scope.mjs",
    "scripts/prepare-bgm-assets.mjs",
    "scripts/security/test-secrets.mjs",
    "scripts/test-harness.mjs",
    "scripts/test-semantic-scope.mjs",
  ];
  const PIN_TEST_NAMERS = [
    "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json",
    "scripts/dot/README.md",
    "scripts/harness/gate-manifest.json",
    "scripts/harness/semantic-scope.mjs",
  ];
  // Reader guards (static name matching, 確度B: a path assembled at run time
  // from non-literal parts is not seen). The experiment showed none of the
  // heavy gates reads these files; the file sets below are pinned, so a new
  // reader file fails the test until the pin is updated (a prompt to review and
  // re-run the experiment, not proof that either happened). A name added inside a
  // file that is already pinned is not detected.
  const SELF_LISTS = [
    "scripts/harness/static-inputs.mjs",
    "scripts/test-path-classification.mjs",
  ];
  // gate-manifest.json is left out of guard (1) (it holds every pattern), but
  // guard (3) pins it: its gate args already name a listed test
  // (room-delivery-unit).
  const SELF_REFERENCING = [
    "scripts/harness/gate-manifest.json",
    ...SELF_LISTS,
  ];
  const textOf = (file) => readFileSync(resolve(root, file), "utf8");
  const exists = (file) => existsSync(resolve(root, file));
  // Only these extensions are read, and nothing under manual/, issues/, images/
  // or node_modules/ (the docs gate reads manual and issues): a new reader with
  // another extension or in those directories is not seen by the guards below.
  const TEXT_FILE =
    /\.(?:mjs|cjs|js|ts|tsx|json|jsonl|yml|yaml|ps1|sh|toml|html|css|md|txt)$/;
  const readable = (file) =>
    exists(file) &&
    TEXT_FILE.test(file) &&
    !/^(?:manual|issues|images|node_modules)\//.test(file);
  // Exactly what vitest.config.ts collects: these run under `vitest`, which both
  // overrides keep.
  const VITEST_COLLECTED = /^(?:packages|apps)\/(?:.+\/)?test\/.*\.test\.ts$/;
  // (1) Any script, deploy or workflow file, root file or package.json that
  // mentions the app directory at all: this catches pieces of a path
  // (join("apps", "playground-web", "src")) and escaped patterns, which a
  // full-path search would not.
  const mentions = tracked
    .filter(
      (file) =>
        readable(file) &&
        (/^(?:scripts|deploy|\.github)\//.test(file) ||
          !file.includes("/") ||
          /(?:^|\/)package\.json$/.test(file)) &&
        !SELF_REFERENCING.includes(file) &&
        textOf(file).includes("playground-web")
    )
    .sort();
  assert.deepEqual(
    mentions,
    PIN_MENTIONS,
    "a file newly mentions playground-web: check whether a gate reads src/test through it, then re-run the mutation experiment"
  );
  // (2) Files that contain the literal "apps": four walk the whole apps/ tree
  // without naming playground-web (check-card-test-coverage, the
  // text-accountability audit, check-ssot, ssot-candidate-scan), two only
  // mention it (gate-evidence, test-effect-debug-loop-state). The experiment is
  // the only evidence for the walkers, so a new file that has the literal is
  // reviewed.
  const walkers = tracked
    .filter(
      (file) =>
        readable(file) &&
        /^(?:scripts|deploy|\.github)\//.test(file) &&
        !SELF_LISTS.includes(file) &&
        /["'`]apps["'`]/.test(textOf(file))
    )
    .sort();
  assert.deepEqual(
    walkers,
    PIN_WALKERS,
    "a file newly walks apps/: check whether a gate reads src/test through it, then re-run the mutation experiment"
  );
  // (3) Any non-test file that spells out the path of a listed file, with or
  // without the extension (import "../apps/playground-web/src/x"): data such as
  // an audit's testRefs or a fixture is read by a gate through that name. Names
  // of listed src files are not compared for e2e specs (the old full fallback
  // did not run most of them either, and the GUI gates the src rule keeps run
  // the rest) nor for the app's own src (covered by the rule).
  const stemOf = (name) => name.replace(/\.[A-Za-z0-9]+$/, "");
  const srcNames = new Set(PLAYGROUND_SRC_FILES);
  const srcStems = new Set(PLAYGROUND_SRC_FILES.map(stemOf));
  const testNames = new Set(PLAYGROUND_TEST_FILES);
  const testStems = new Set(PLAYGROUND_TEST_FILES.map(stemOf));
  const listedPaths = new Set([...srcNames, ...testNames]);
  // The e2e spec list shares the fuzz-closure check below (its own guards are
  // in the e2e block that follows).
  const fuzzListedPaths = new Set([...listedPaths, ...E2E_SPEC_FILES]);
  const namersOf = (names, stems, skip) =>
    tracked
      .filter(
        (file) =>
          readable(file) &&
          !SELF_LISTS.includes(file) &&
          !VITEST_COLLECTED.test(file) &&
          !skip.test(file) &&
          (
            textOf(file).match(
              /apps\/playground-web\/(?:src|test)\/[A-Za-z0-9_./-]+/g
            ) ?? []
          ).some((name) => {
            const bare = name.replace(/\.+$/, "");
            return names.has(bare) || stems.has(bare);
          })
      )
      .sort();
  assert.deepEqual(
    namersOf(srcNames, srcStems, /^(?:e2e\/|apps\/playground-web\/src\/)/),
    PIN_SRC_NAMERS,
    "a file newly names a listed src path: check whether a gate reads it, then re-run the mutation experiment"
  );
  assert.deepEqual(
    namersOf(testNames, testStems, /^apps\/playground-web\/src\//),
    PIN_TEST_NAMERS,
    "a file newly names a listed test path: check whether a gate reads it, then re-run the mutation experiment"
  );
  // (4) The merge fuzz rests on one fact: no listed file is in the import
  // closure of its entry points (the fuzz test, the runners and the vitest
  // config). Compute that closure (static and literal dynamic imports, vi.mock
  // paths, types included, so it over-approximates; the @orica/* aliases of
  // vitest.config.ts) and require it empty of listed files. A new import from
  // selfplay-driver.ts into src/ or into a listed test would otherwise pass
  // unseen.
  const trackedNow = new Set(tracked.filter(exists));
  const aliases = {
    "@orica/rules-core": "packages/rules-core/src/index.ts",
    "@orica/card-data": "packages/card-data/src/index.ts",
  };
  // The alias table above must stay the one in vitest.config.ts: an alias added
  // there without a line here would let a closure edge be dropped silently.
  assert.deepEqual(
    [...textOf("vitest.config.ts").matchAll(/"(@orica\/[a-z-]+)"\s*:/g)]
      .map((match) => match[1])
      .sort(),
    Object.keys(aliases).sort(),
    "vitest.config.ts aliases changed: update the fuzz closure aliases"
  );
  const suffixes = [
    "",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".js",
    ".json",
    "/index.ts",
    "/index.tsx",
    "/index.mjs",
    "/index.js",
  ];
  const resolveImport = (from, spec) => {
    if (aliases[spec]) return aliases[spec];
    if (!spec.startsWith(".")) return null;
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    const bases = [base, base.replace(/\.js$/, ".ts")];
    for (const candidate of bases)
      for (const suffix of suffixes)
        if (trackedNow.has(candidate + suffix)) return candidate + suffix;
    return undefined;
  };
  const fuzzEntries = [
    "apps/playground-web/test/selfplay-fuzz.test.ts",
    "scripts/fuzz-runner.mjs",
    "scripts/run-fuzz.mjs",
    "vitest.config.ts",
  ];
  const closure = new Set();
  const unresolved = [];
  const pending = [...fuzzEntries];
  while (pending.length) {
    const file = pending.pop();
    if (closure.has(file)) continue;
    closure.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const text = textOf(file);
    const specs = [
      ...ts
        .preProcessFile(text, true, true)
        .importedFiles.map((ref) => ref.fileName),
      ...[...text.matchAll(/\bvi\.(?:mock|doMock)\(\s*["']([^"']+)["']/g)].map(
        (match) => match[1]
      ),
    ];
    for (const spec of specs) {
      const target = resolveImport(file, spec);
      if (target) pending.push(target);
      else if (target === undefined) unresolved.push(`${file}: ${spec}`);
    }
  }
  assert.deepEqual(unresolved, [], "fuzz closure has an unresolved import");
  for (const file of [
    ...fuzzEntries,
    "apps/playground-web/test/selfplay-driver.ts",
    "packages/rules-core/src/index.ts",
  ])
    assert.ok(closure.has(file), `${file} is missing from the fuzz closure`);
  assert.ok(closure.size > 200, `fuzz closure too small: ${closure.size}`);
  // import.meta.glob loads files by pattern at run time; a closure that
  // cannot see them would be unsound.
  assert.deepEqual(
    [...closure].filter(
      (file) =>
        /\.[cm]?[jt]sx?$/.test(file) &&
        textOf(file).includes("import.meta.glob")
    ),
    [],
    "a fuzz closure file uses import.meta.glob"
  );
  assert.deepEqual(
    [...closure].filter((file) => fuzzListedPaths.has(file)),
    [],
    "a listed file entered the merge fuzz import closure: drop it from the list and keep the fuzz"
  );
  // The merge fuzz is exempt for every listed file (the neighbours below keep it): neither
  // entry point imports them.
  for (const file of [
    ...PLAYGROUND_SRC_FILES,
    ...PLAYGROUND_TEST_FILES,
    ...E2E_SPEC_FILES,
  ]) {
    assert.equal(requiresMergeFuzz([file]), false, file);
    assert.equal(
      mergeFuzzRequired([file], { [file]: pathOverride(file) }),
      false,
      file
    );
  }
  for (const file of [
    ...srcNeighbours,
    "apps/playground-web/test/brand-new.test.ts",
    "apps/playground-web/test/selfplay-driver.ts",
    "apps/playground-web/test/selfplay-fuzz.test.ts",
    "packages/rules-core/src/runtime.ts",
    "scripts/fuzz-runner.mjs",
  ]) {
    assert.equal(requiresMergeFuzz([srcFile, file]), true, file);
    assert.equal(requiresMergeFuzz([testFile, file]), true, file);
  }
}

// P2-16 e2e specs. Measured 2026-11-03 by corrupting and then deleting all 221
// listed specs (the Playwright specs classifyPath reported reviewed-full, less
// deck-builder-layout.spec.ts, which the saved-deck-ui gate runs by name, and
// the helpers/fixtures kept at full verification) against an unmutated
// baseline: 31 gates and the merge fuzz kept their result (see
// semantic-scope.mjs). The structural reason is what the guards below hold:
// no gate executes a listed spec, nothing imports one, and the readers of the
// e2e directory are a fixed set. Exact paths: a spec added later keeps the full
// fallback and raises the new-verification finding.
{
  const { pathOverride, semanticScope, E2E_SPEC_GATES } =
    await import("./harness/semantic-scope.mjs");
  const { E2E_SPEC_FILES, isE2eSpecFile } =
    await import("./harness/static-inputs.mjs");
  const tracked = trackedPaths(root);
  assert.deepEqual(E2E_SPEC_GATES, [
    "secrets",
    "docs",
    "harness",
    "e2e-changed",
  ]);
  // The population is evidence-tracked: the list is exactly the specs the
  // experiments mutated. Adding one needs a new experiment; the count and the
  // digest make that a visible friction (not proof that one was run).
  assert.equal(E2E_SPEC_FILES.length, 216);
  assert.equal(new Set(E2E_SPEC_FILES).size, E2E_SPEC_FILES.length);
  assert.equal(
    createHash("sha256")
      .update([...E2E_SPEC_FILES].sort().join("\n"))
      .digest("hex"),
    "67ace27c81026997aa46cb3852bab93594c646c53f95348c1e85a9286edeff37",
    "the measured population changed: re-run the mutation experiment for an added spec"
  );
  const patternHit = (patterns, file) =>
    patterns.some((pattern) => new RegExp(pattern).test(file));
  const gateArgs = new Set(
    Object.values(manifest.gates).flatMap((gate) => gate.args ?? [])
  );
  for (const file of E2E_SPEC_FILES) {
    assert.ok(tracked.includes(file), `${file} is not known to git`);
    // A deletion that is not staged stays in the index, so ask the disk too.
    assert.ok(existsSync(resolve(root, file)), `${file} is missing on disk`);
    assert.ok(/^e2e\/(?:security\/)?[a-z0-9-]+\.spec\.ts$/.test(file), file);
    assert.ok(
      !manifest.scopes.some((scope) => patternHit(scope.patterns, file)),
      `${file} is claimed by a scope`
    );
    assert.ok(
      !(manifest.requiredScopes ?? []).some((scope) =>
        patternHit(scope.patterns, file)
      ),
      `${file} is claimed by a required scope`
    );
    // A spec some gate runs by name is observed by that gate.
    assert.ok(!gateArgs.has(file), `${file} is run by a gate`);
    assert.deepEqual(classifyPath(file), {
      kind: "override",
      gates: E2E_SPEC_GATES,
    });
  }
  // Neighbours keep the full fallback: a new spec, the helpers and fixtures
  // (three imported by executed specs, three only by listed specs and not
  // measured), and the spec a gate runs by name.
  const e2eNeighbours = [
    "e2e/brand-new.spec.ts",
    "e2e/helpers.ts",
    "e2e/title-fixtures.ts",
    "e2e/legal-main-deck.ts",
    "e2e/room-installed-assets.ts",
    "e2e/security/auth-helpers.ts",
    "e2e/fixtures/field-magic-pre-cost-resume.json",
    "e2e/deck-builder-layout.spec.ts",
    "e2e/account-link.spec.ts.bak",
  ];
  for (const file of e2eNeighbours) {
    assert.equal(isE2eSpecFile(file), false, file);
    assert.equal(pathOverride(file), undefined, file);
  }
  assert.equal(classifyPath("e2e/brand-new.spec.ts").kind, "reviewed-full");
  assert.equal(classifyPath("e2e/helpers.ts").kind, "reviewed-full");
  // Specs that a scope already claims keep their own scope.
  for (const file of [
    "e2e/home-lobby.spec.ts",
    "e2e/local-game-sync.spec.ts",
  ]) {
    assert.equal(isE2eSpecFile(file), false, file);
    assert.notDeepEqual(classifyPath(file).gates, E2E_SPEC_GATES, file);
  }
  // The integrated selection hands the same override out; merge, finish, push
  // and ci no longer carry the gates the experiment left unchanged.
  const specFile = E2E_SPEC_FILES[0];
  assert.deepEqual(semanticScope(root, [specFile], ["HEAD"]).overrides, {
    [specFile]: E2E_SPEC_GATES,
  });
  const idle = [
    "handoff",
    "ismcts-program",
    "ismcts-runtime",
    "fidelity",
    "auto-merge-integration",
    "telegram",
    "supervisor-runner-lock",
    "storage",
    "effect-debug",
    "verifier",
    "ledger",
    "wiring",
    "ssot",
    "card-tests",
    "types",
    "vitest",
    "build",
    "scenario",
    "local-game-ui",
    "public-build",
  ];
  for (const file of E2E_SPEC_FILES)
    for (const profile of ["finish", "push", "merge", "ci"]) {
      const selected = selectGates(
        profile,
        [file],
        () => null,
        () => false,
        [],
        { [file]: pathOverride(file) }
      );
      assert.deepEqual(
        selected.sort(),
        ["changed-style", ...E2E_SPEC_GATES].sort(),
        `${profile}: ${file}`
      );
      for (const id of idle)
        assert.ok(!selected.includes(id), `${profile}: ${id}`);
    }
  for (const neighbour of e2eNeighbours) {
    const mixed = selectGatePlan(
      "merge",
      [specFile, neighbour],
      undefined,
      undefined,
      [],
      { [specFile]: pathOverride(specFile) }
    );
    assert.equal(
      mixed.unresolved.some((entry) => entry.file === neighbour),
      neighbour !== "e2e/deck-builder-layout.spec.ts"
    );
    assert.ok(mixed.ids.includes("e2e-changed"));
  }

  // The merge fuzz exemption for the listed specs is asserted with the other
  // lists above (the closure check includes them); here the integrated
  // decision: a spec alone never asks for it, a spec next to a neighbour does.
  assert.equal(requiresMergeFuzz([specFile, "e2e/brand-new.spec.ts"]), true);
  assert.equal(
    mergeFuzzRequired([specFile], { [specFile]: pathOverride(specFile) }),
    false
  );

  // Reader guards (static name matching, 確度B: a path assembled at run time
  // is not seen). The file sets are pinned, so a new reader fails the test
  // until the pin is updated (a prompt to review and re-run the experiment,
  // not proof that either happened). A name added inside a pinned file is not
  // detected. Only these extensions are read, and nothing under manual/,
  // issues/, images/ or node_modules/.
  const SELF_LISTS = [
    "scripts/harness/static-inputs.mjs",
    "scripts/test-path-classification.mjs",
  ];
  const TEXT_FILE =
    /\.(?:mjs|cjs|js|ts|tsx|json|jsonl|yml|yaml|ps1|sh|toml|html|css|md|txt)$/;
  const textOf = (file) => readFileSync(resolve(root, file), "utf8");
  const outside = tracked.filter(
    (file) =>
      existsSync(resolve(root, file)) &&
      TEXT_FILE.test(file) &&
      !E2E_SPEC_FILES.includes(file) &&
      !/^(?:manual|issues|images|node_modules)\//.test(file) &&
      !SELF_LISTS.includes(file)
  );
  const texts = new Map(outside.map((file) => [file, textOf(file)]));
  const stems = E2E_SPEC_FILES.map((file) =>
    file.replace(/\.[A-Za-z0-9]+$/, "")
  );
  // (1) Any file that spells out the path of a listed spec, with or without the
  // extension: data such as an audit's guiTestRef or a comment may be read by a
  // gate through that name. The two tests are comments; the others are data.
  assert.deepEqual(
    outside.filter((file) =>
      stems.some((stem) => texts.get(file).includes(stem))
    ),
    [
      "apps/playground-web/test/room-sse-liveness-contract.test.ts",
      "apps/playground-web/test/zone-browse-modal.test.ts",
      "autorun-queue/cluster-registry.json",
      "needs-ruling.jsonl",
      "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json",
      "scripts/harness/e2e-known-failures.json",
      "scripts/test-e2e-run.mjs",
    ],
    "a file newly names a listed e2e spec: check whether a gate reads it, then re-run the mutation experiment"
  );
  // (2) Any file that contains the bare word e2e (not part of a longer name
  // such as e2e-attachments): a path in any spelling (a regex literal, a glob,
  // a shell argument, a join) is caught, which a walker that reads the
  // directory without naming a spec needs. Prose and test names that say e2e
  // are caught as well, so the pin is wide on purpose.
  const E2E_DIR = /(?<![\w-])e2e(?![\w-])/;
  assert.deepEqual(
    outside.filter((file) => E2E_DIR.test(texts.get(file))),
    [
      ".gitleaks.toml",
      // 固定アカウント用 env ファイル名 `.env.e2e.local` を書くだけ。spec の列挙・
      // 経路の組み立てはせず、gate が spec をこのファイル経由で読むことはない。
      "apps/playground-web/load-server-env.ts",
      "apps/playground-web/server/public-build.ts",
      "apps/playground-web/src/scenarios.ts",
      // Unit test imports the auth helper directly and mocks its network client.
      "apps/playground-web/test/e2e-auth-helpers.test.ts",
      "apps/playground-web/test/mcts.test.ts",
      "apps/playground-web/test/room-deck-selection.test.ts",
      "apps/playground-web/test/room-invitations-cleanup.test.ts",
      "apps/playground-web/test/room-sse-liveness-contract.test.ts",
      "apps/playground-web/test/room-sync-errors.test.ts",
      "apps/playground-web/test/zone-browse-modal.test.ts",
      "autorun-queue/cluster-registry.json",
      "autorun-queue/needs-dsl.audit.jsonl",
      "e2e/ai-search-public-zone-instances.spec.ts",
      "e2e/replay-viewer.spec.ts",
      "e2e/reveal-retrieval-audit.spec.ts",
      "e2e/security/auth-helpers.ts",
      "needs-ruling.jsonl",
      "package.json",
      "packages/ai/README.md",
      "packages/ai/src/cli/e2e-attachments.ts",
      "packages/ai/src/cli/e2e-skill-trigger.ts",
      "packages/rules-core/src/legal/legal-actions-apply.ts",
      "packages/rules-core/test/bsaz01-c03-exclude-threshold.test.ts",
      "packages/rules-core/test/bsth001-tensei-r02-destroy-trigger.test.ts",
      "packages/rules-core/test/bsth05_5-cards.test.ts",
      "packages/rules-core/test/burst-effect-activation-e2e.test.ts",
      "packages/rules-core/test/cost-modify-additional-cost-player-path.test.ts",
      "packages/rules-core/test/engine-free-magic-use-target-selection-nonfield-candidate-zones.test.ts",
      "packages/rules-core/test/engine-leave-field-free-use-stay-on-field-flush-gate.test.ts",
      "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json",
      "packages/rules-core/test/game-event-no-duplicate-multi-source.test.ts",
      "packages/rules-core/test/p3-62-triggered-end-to-end.test.ts",
      "packages/rules-core/test/p3-63-burst-recorded-usage-plumbing.test.ts",
      "packages/rules-core/test/p3-73-a5-nullify-resolution-and-windows.test.ts",
      "packages/rules-core/test/p3-73-x05-end-to-end-window-close.test.ts",
      "packages/rules-core/test/remove-from-game-brave-orphan-step3.test.ts",
      "packages/rules-core/test/remove-from-game-brave-orphan-step4.test.ts",
      "packages/rules-core/test/trigger-source-category.test.ts",
      "packages/rules-core/test/usage-limit-per-trigger-activation-e2e.test.ts",
      "playwright.config.ts",
      "scripts/e2e-run.mjs",
      "scripts/fidelity-review-resolutions.json",
      "scripts/harness/e2e-known-failures.json",
      "scripts/harness/e2e-run-core.mjs",
      "scripts/harness/gate-manifest.json",
      "scripts/harness/gate-manifest.mjs",
      "scripts/harness/path-classification.mjs",
      "scripts/harness/scenario-registration-scope.mjs",
      "scripts/harness/semantic-scope.mjs",
      "scripts/register-supervisor-task.ps1",
      "scripts/test-e2e-run-wiring.mjs",
      "scripts/test-e2e-run.mjs",
      "scripts/test-harness.mjs",
      "scripts/test-local-game-gates.mjs",
      "scripts/test-semantic-scope.mjs",
      "scripts/test-supervisor-followup-evidence.mjs",
    ],
    "a file newly mentions e2e: check whether a gate reads the specs through it, then re-run the mutation experiment"
  );
  // (3) Any file outside e2e/ that mentions playwright: the only way a spec is
  // executed is a Playwright run, so a new runner (a gate, a script, a workflow)
  // is reviewed. The e2e/ files that import @playwright/test are skipped (they are
  // covered by (7)); the three e2e files that do not import it are scanned.
  assert.deepEqual(
    outside.filter(
      (file) =>
        !(
          file.startsWith("e2e/") &&
          /["']@playwright\/test["']/.test(texts.get(file))
        ) && /playwright/i.test(texts.get(file))
    ),
    [
      ".codex/config.toml",
      ".codex/hooks/stop-guard.js",
      ".codex/hooks/test-stop-guard.js",
      ".codex/skills/orica-scenario-test/SKILL.md",
      ".github/workflows/ci.yml",
      ".mcp.json",
      "apps/playground-web/test/room-invitations-cleanup.test.ts",
      "autorun-queue/cluster-registry.json",
      "package.json",
      "packages/rules-core/test/listener-less-step-event.test.ts",
      "playwright.config.ts",
      "playwright.local.config.ts",
      "playwright.public.config.ts",
      "pnpm-lock.yaml",
      "scripts/check-docs.mjs",
      "scripts/check-ssot.mjs",
      "scripts/doc-links.mjs",
      "scripts/e2e-run.mjs",
      "scripts/gate-evidence.mjs",
      "scripts/harness/check-dev-server-contract.mjs",
      "scripts/harness/e2e-run-core.mjs",
      "scripts/harness/gate-manifest.json",
      "scripts/harness/gate-manifest.mjs",
      "scripts/harness/recover-gate-lease.mjs",
      "scripts/harness/run-gates.mjs",
      "scripts/harness/semantic-scope.mjs",
      // Replays the selected files from a prior run receipt.
      "scripts/ismcts/evidence.mjs",
      "scripts/ssot-candidate-scan.mjs",
      "scripts/supervisor-followup-evidence.mjs",
      "scripts/supervisor-health.mjs",
      "scripts/test-e2e-run-wiring.mjs",
      "scripts/test-e2e-run.mjs",
      "scripts/test-harness.mjs",
      "scripts/test-local-game-gates.mjs",
      "scripts/test-semantic-scope.mjs",
      "scripts/test-supervisor-followup-evidence.mjs",
      "scripts/test-supervisor-handoff.mjs",
      "scripts/test-supervisor-health.mjs",
      "scripts/watchdog-stale-processes.mjs",
    ],
    "a file newly mentions playwright: check whether it runs the listed specs, then re-run the mutation experiment"
  );
  // (4) Every way the repository launches Playwright runs only files or a
  // config that name their specs, and none of them is a listed one: a launcher
  // without a file filter, a config whose testMatch is a glob, or a launch
  // through a script or another binary would execute the listed specs and make
  // the experiment moot.
  const isPlaywrightGate = (gate) =>
    gate.bin === "playwright" || gate.node?.includes("@playwright/test/cli.js");
  // No gate may launch Playwright in a shape this guard does not understand
  // (a package.json script, `pnpm exec playwright`, another binary), and
  // package.json must define no Playwright script at all.
  assert.deepEqual(
    Object.entries(manifest.gates)
      .filter(
        ([, gate]) =>
          !isPlaywrightGate(gate) && /playwright/i.test(JSON.stringify(gate))
      )
      .map(([id]) => id),
    [],
    "a gate launches Playwright in an unreviewed shape"
  );
  assert.deepEqual(
    Object.entries(JSON.parse(textOf("package.json")).scripts ?? {}).filter(
      ([name, command]) => /playwright/i.test(`${name} ${command}`)
    ),
    [],
    "package.json defines a Playwright script"
  );
  // CI workflows may only install the browser (the one exact line) and upload
  // its results folder (the one exact path line), anything else naming
  // Playwright on a line fails, including a command appended to the install.
  // Running Playwright is the gates' job: a workflow step that ran it would
  // execute the listed specs inside a file guard (3) pins only by name.
  for (const file of tracked.filter(
    (name) =>
      /^\.github\/workflows\/.+\.ya?ml$/.test(name) &&
      existsSync(resolve(root, name))
  ))
    for (const line of textOf(file).split("\n"))
      if (/playwright/i.test(line))
        assert.ok(
          /^\s*run: pnpm exec playwright install --with-deps chromium\s*$|^\s*\.codex-temp\/playwright-test-results\/\s*$/.test(
            line
          ),
          `${file}: a workflow line runs Playwright: ${line.trim()}`
        );
  // The allowed configs run exactly these files (their whole testMatch). The
  // property is pinned by its exact text, not parsed: a glob, a regular
  // expression, a template literal or a .concat() added to it changes the text
  // and fails here, and the word may appear only once.
  const ALLOWED_CONFIGS = {
    "playwright.local.config.ts": {
      names: [
        "local-game-sync.spec.ts",
        "scenario-partial-target-resolution.spec.ts",
        "scenario-blazing-star-oracle.spec.ts",
        "scenario-effect-usage-accounting.spec.ts",
      ],
      property: [
        "testMatch: [",
        '    "local-game-sync.spec.ts",',
        '    "scenario-partial-target-resolution.spec.ts",',
        '    "scenario-blazing-star-oracle.spec.ts",',
        '    "scenario-effect-usage-accounting.spec.ts",',
        "  ],",
      ].join("\n"),
    },
    "playwright.public.config.ts": {
      names: ["public-build.spec.ts"],
      property: 'testMatch: "public-build.spec.ts",',
    },
  };
  for (const [configFile, { names, property }] of Object.entries(
    ALLOWED_CONFIGS
  )) {
    const configText = textOf(configFile);
    assert.ok(configText.includes(property), `${configFile} testMatch changed`);
    assert.equal(
      configText.match(/testMatch/g).length,
      1,
      `${configFile} has more than one testMatch`
    );
    for (const name of names)
      assert.equal(
        E2E_SPEC_FILES.includes(`e2e/${name}`),
        false,
        `${configFile} runs a listed spec`
      );
  }
  const playwrightGates = Object.entries(manifest.gates).filter(([, gate]) =>
    isPlaywrightGate(gate)
  );
  assert.ok(playwrightGates.length > 20, "playwright gates not found");
  for (const [id, gate] of playwrightGates) {
    const args = gate.args ?? [];
    const config = args.indexOf("--config");
    if (config >= 0) {
      const configFile = args[config + 1];
      assert.ok(
        Object.hasOwn(ALLOWED_CONFIGS, configFile),
        `${id}: unreviewed playwright config ${configFile}`
      );
      // Nothing else: a second --config / -c (the last one would win), a
      // positional filter or any flag changes what runs.
      assert.deepEqual(
        args,
        id === "scenario-file-scenario-partial-target-resolution"
          ? [
              "test",
              "e2e/scenario-partial-target-resolution.spec.ts",
              "--config",
              "playwright.local.config.ts",
            ]
          : ["test", "--config", configFile],
        `${id}: a config gate takes exactly test --config <allowed config>`
      );
    } else {
      // Every positional argument after `test` is an exact literal spec path:
      // a bare token such as scenario- is a regular expression to Playwright and
      // would run the listed specs, and a flag value would hide behind it.
      assert.equal(args[0], "test", `${id}: unreviewed playwright command`);
      const files = args.slice(1);
      assert.ok(files.length > 0, `${id}: runs the whole e2e directory`);
      for (const file of files)
        assert.ok(
          /^e2e\/(?:security\/)?[a-z0-9-]+\.spec\.ts$/.test(file),
          `${id}: ${file} is not an exact spec path`
        );
      assert.deepEqual(
        files.filter((file) => E2E_SPEC_FILES.includes(file)),
        [],
        `${id} runs a listed spec`
      );
      // Playwright reads a positional argument as a regular expression over the
      // test file path, so a partial name such as e2e/scenario- would run the
      // listed specs without naming one.
      for (const file of files)
        assert.deepEqual(
          E2E_SPEC_FILES.filter((spec) => new RegExp(file).test(spec)),
          [],
          `${id}: the filter ${file} matches a listed spec`
        );
    }
  }
  // (5) Nothing imports a listed spec (relative specifier, any extension).
  const importers = [];
  const IMPORT =
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;
  for (const file of tracked.filter(
    (name) => /\.[cm]?[jt]sx?$/.test(name) && existsSync(resolve(root, name))
  ))
    for (const match of textOf(file).matchAll(IMPORT)) {
      const target = posix
        .normalize(posix.join(posix.dirname(file), match[1]))
        .replace(/\.js$/, "");
      if (E2E_SPEC_FILES.includes(target) || stems.includes(target))
        importers.push(`${file} -> ${target}`);
    }
  assert.deepEqual(importers, [], "a listed e2e spec is imported");
  // (6) Any file that contains the bare word spec (.spec, (test|spec),
  // {test,spec}, a readdir filter): a reader that scans the tree by extension
  // instead of naming e2e would otherwise pass guard (2). Existing scanners
  // (check-card-test-coverage.mjs, the text-accountability audit) use the
  // (test|spec) spelling; they are pinned below and today root only in
  // packages, apps, tests and scripts.
  assert.deepEqual(
    outside.filter((file) =>
      /(?<![A-Za-z0-9_])spec(?![A-Za-z0-9_])/.test(texts.get(file))
    ),
    [
      ".gitleaks.toml",
      "apps/playground-web/server/public-build.ts",
      "apps/playground-web/src/coreSelectionFacade.ts",
      "apps/playground-web/src/scenarios.ts",
      "apps/playground-web/test/action-bar-hide-condition.test.ts",
      "apps/playground-web/test/room-sse-liveness-contract.test.ts",
      "apps/playground-web/test/zone-browse-modal.test.ts",
      "autorun-queue/cluster-registry.json",
      "autorun-queue/needs-dsl.audit.jsonl",
      "autorun-queue/needs-dsl.w1.jsonl",
      "e2e/app-theme.spec.ts",
      "e2e/helpers.ts",
      "e2e/public-build.spec.ts",
      "e2e/scenario-four-of-a-kind.spec.ts",
      "e2e/security/auth-helpers.ts",
      "needs-ruling.jsonl",
      "packages/rules-core/src/dsl-types.ts",
      "packages/rules-core/src/effect/native-ce-registration-handlers.ts",
      "packages/rules-core/src/legal/legal-actions-types.ts",
      "packages/rules-core/src/training-decision-surface.ts",
      "packages/rules-core/test/bsth05-x02-grand-domain-recover.test.ts",
      "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json",
      "packages/rules-core/test/p3-52-candidate-target-filter.test.ts",
      "packages/rules-core/test/target-spec-trigger-related-instance.test.ts",
      "playwright.config.ts",
      "playwright.local.config.ts",
      "playwright.public.config.ts",
      "scripts/card-text-accountability-audit.mjs",
      "scripts/card-text-accountability-core.mjs",
      "scripts/cards-coverage.mjs",
      "scripts/check-card-test-coverage.mjs",
      "scripts/check-ssot.mjs",
      "scripts/check-wiring.mjs",
      "scripts/e2e-run.mjs",
      "scripts/fidelity-review-resolution.mjs",
      "scripts/fidelity-review-resolutions.json",
      "scripts/gate-evidence.mjs",
      "scripts/harness/e2e-known-failures.json",
      "scripts/harness/e2e-run-core.mjs",
      "scripts/harness/focused-inputs.mjs",
      "scripts/harness/gate-manifest.json",
      "scripts/harness/gate-manifest.mjs",
      "scripts/harness/path-classification.mjs",
      "scripts/harness/scenario-registration-scope.mjs",
      "scripts/harness/semantic-scope.mjs",
      "scripts/notices/digest.mjs",
      "scripts/ssot-candidate-scan.mjs",
      "scripts/supervisor-followup-evidence.mjs",
      "scripts/test-e2e-run-wiring.mjs",
      "scripts/test-e2e-run.mjs",
      "scripts/test-fidelity-review-resolution.mjs",
      "scripts/test-harness.mjs",
      "scripts/test-local-game-gates.mjs",
      "scripts/test-semantic-scope.mjs",
      "scripts/test-supervisor-followup-evidence.mjs",
    ],
    "a file newly mentions spec: check whether it reads the listed specs by extension, then re-run the mutation experiment"
  );
  // (7) The e2e/ files that are not listed run in the gates (scoped specs,
  // helpers, fixtures). One that can read the file system or start a process
  // could read a listed spec at run time through a path assembled from parts,
  // which the name checks (1, 2, 6) do not see. Every bare module they import
  // (Playwright aside) is pinned per file, in any import form the TypeScript
  // parser reports (static, literal dynamic import, require), so a new
  // fs / child_process / fs-extra / glob import fails whatever its spelling.
  // A loader call whose argument is not a literal is pinned empty.
  const e2eCode = tracked.filter(
    (file) =>
      file.startsWith("e2e/") &&
      /\.[cm]?[jt]sx?$/.test(file) &&
      !E2E_SPEC_FILES.includes(file) &&
      existsSync(resolve(root, file))
  );
  const e2eBare = [];
  const e2eNonLiteralLoaders = [];
  for (const file of e2eCode) {
    const text = textOf(file);
    for (const reference of ts.preProcessFile(text, true, true).importedFiles) {
      const name = reference.fileName;
      if (!name.startsWith(".") && name !== "@playwright/test")
        e2eBare.push(`${file} :: ${name}`);
    }
    // Anything but a plain quoted string (no substitution) as the argument.
    if (
      /\b(?:import|require)\(\s*(?!(?:"[^"\\]*"|'[^'\\]*'|`[^`$\\]*`)\s*[,)])/.test(
        text
      )
    )
      e2eNonLiteralLoaders.push(file);
  }
  assert.deepEqual(
    e2eBare.sort(),
    [
      "e2e/local-game-fixture.ts :: @orica/rules-core",
      "e2e/local-game-fixture.ts :: node:crypto",
      "e2e/public-build.spec.ts :: node:fs",
      "e2e/public-build.spec.ts :: node:fs/promises",
      "e2e/public-build.spec.ts :: node:http",
      "e2e/public-build.spec.ts :: node:path",
      "e2e/replay-viewer.spec.ts :: node:fs",
      "e2e/replay-viewer.spec.ts :: node:path",
      "e2e/replay-viewer.spec.ts :: node:zlib",
      "e2e/room-invitations-cleanup.ts :: @supabase/supabase-js",
      "e2e/room-invitations-live.spec.ts :: @supabase/supabase-js",
      "e2e/scenario-brave-spirit-events.spec.ts :: @orica/rules-core",
      "e2e/scenario-deck-exclusion.spec.ts :: @orica/rules-core",
      "e2e/scenario-declaration-cues.spec.ts :: @orica/rules-core",
      "e2e/scenario-kaname-removal.spec.ts :: @orica/rules-core",
      "e2e/scenario-post-draw-selection.spec.ts :: @orica/rules-core",
      "e2e/scenario-post-stack-step-choice.spec.ts :: @orica/rules-core",
      "e2e/scenario-soul-state-brave-battle.spec.ts :: node:fs",
      "e2e/security/auth-helpers.ts :: @supabase/supabase-js",
      "e2e/title-asset-storage.spec.ts :: node:crypto",
      "e2e/title-fixtures.ts :: node:crypto",
      "e2e/title-image-download.spec.ts :: node:crypto",
    ],
    "an e2e file that is not listed newly imports a bare module: check whether it can read a listed spec, then re-run the mutation experiment"
  );
  assert.deepEqual(
    e2eNonLiteralLoaders,
    [],
    "an e2e file that is not listed loads a module by a computed name"
  );
}

console.log("path classification tests passed");
