import assert from "node:assert/strict";
import {
  fullGates,
  selectGates,
  requiresMergeFuzz,
} from "./harness/gate-manifest.mjs";
const file = "e2e/scenario-four-of-a-kind.spec.ts";
const target = "scenario-file-scenario-four-of-a-kind";
for (const profile of ["finish", "push", "merge"]) {
  assert.deepEqual(selectGates(profile, [file]), ["changed-style", target]);
  assert.equal(requiresMergeFuzz([file]), false);
  assert.deepEqual(selectGates(profile, ["e2e/public-build.spec.ts"]), [
    "changed-style",
    "build",
    "public-build",
  ]);
  assert.deepEqual(selectGates(profile, ["e2e/local-game-sync.spec.ts"]), [
    "changed-style",
    "local-game-ui",
  ]);
  const mixed = selectGates(profile, [
    file,
    "packages/rules-core/src/runtime.ts",
  ]);
  for (const gate of fullGates) assert.ok(mixed.includes(gate));
  assert.ok(mixed.includes(target));
  assert.equal(
    requiresMergeFuzz([file, "packages/rules-core/src/runtime.ts"]),
    true
  );
}
assert.deepEqual(selectGates("scenario"), ["scenario"]);
assert.deepEqual(
  selectGates("scenario", [], undefined, undefined, [file, file]),
  [target]
);
assert.throws(
  () => selectGates("scenario", [], undefined, undefined, ["--help"]),
  /Unregistered/
);
assert.throws(
  () =>
    selectGates("scenario", [], undefined, undefined, [
      "e2e/nonexistent.spec.ts",
    ]),
  /Unregistered/
);
assert.deepEqual(selectGates("public-build"), ["build", "public-build"]);
assert.ok(selectGates("ci").includes("local-game-ui"));
assert.ok(selectGates("ci").includes("public-build"));
assert.ok(
  selectGates("finish", ["apps/playground-web/server/game-api.ts"]).includes(
    "local-game-ui"
  )
);
for (const [file, expected] of [
  ["playwright.local.config.ts", ["local-game-ui"]],
  ["playwright.public.config.ts", ["build", "public-build"]],
]) {
  const mixed = selectGates("finish", [file, "unknown.ts"]);
  for (const gate of [...fullGates, ...expected])
    assert.ok(mixed.includes(gate), `${file}: ${gate}`);
}
const newGamePath = "packages/rules-core/src/effect/new-module.ts";
const newGameAndGui = selectGates(
  "finish",
  [file, newGamePath],
  () => [],
  () => true
);
for (const gate of [...fullGates, target])
  assert.ok(newGameAndGui.includes(gate));
assert.equal(
  requiresMergeFuzz(
    [file, newGamePath],
    () => [],
    () => true
  ),
  true
);
console.log("local game gate selection passed");
