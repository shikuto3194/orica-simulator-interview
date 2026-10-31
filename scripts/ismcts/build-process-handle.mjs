// Explicit development build. Production admission loads a matching artifact
// and never starts a compiler. All generated files stay in the ignored bucket.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { homedir } from "node:os";
import { processMeterArtifact } from "./windows-process-handle.mjs";
import { atomicJson, hash, safePath } from "./shared.mjs";

export function buildProcessMeter() {
  const artifact = processMeterArtifact();
  mkdirSync(artifact.directory, { recursive: true });
  const headers = resolve(
    homedir(),
    "AppData/Local/node-gyp/Cache",
    process.version.slice(1)
  );
  const vswhere = resolve(
    process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
    "Microsoft Visual Studio/Installer/vswhere.exe"
  );
  const installation = execFileSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8", windowsHide: true }
  ).trim();
  if (
    !installation ||
    !existsSync(join(headers, "include/node/node_api.h")) ||
    !existsSync(join(headers, "x64/node.lib"))
  )
    throw new Error(
      "native process meter build requires local MSVC and matching Node headers/lib"
    );
  const build = safePath(mkdtempSync(join(artifact.directory, "build-")));
  const source = fileURLToPath(
    new URL("./windows-process-handle.cc", import.meta.url)
  );
  const paths = [installation, headers, build, source];
  if (paths.some((p) => /[%!&|<>^\r\n"]/.test(p)))
    throw new Error("unsupported native build path");
  const binary = join(build, "meter.node");
  const command = [
    "@echo off",
    `call "${join(installation, "Common7/Tools/VsDevCmd.bat")}" -arch=x64 >nul`,
    "if errorlevel 1 exit /b 1",
    `cl /nologo /LD /EHsc /std:c++17 /O2 /W4 /WX /DNAPI_VERSION=8 /DNODE_GYP_MODULE_NAME=orica_process_meter /I"${join(headers, "include/node")}" "${source}" /Fo"${join(build, "meter.obj")}" /link /OUT:"${binary}" /IMPLIB:"${join(build, "meter.lib")}" "${join(headers, "x64/node.lib")}" kernel32.lib`,
    "",
  ].join("\r\n");
  const script = join(build, "build.cmd");
  writeFileSync(script, command);
  execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", script], {
    cwd: build,
    windowsHide: true,
    stdio: "pipe",
    timeout: 60000,
  });
  const binarySha256 = hash(readFileSync(binary));
  // Refuse accidental rebuild while an image exists/has been loaded. A build
  // key changes with every source input. Reuse must verify existing bytes.
  if (existsSync(artifact.binary)) {
    const existing = JSON.parse(readFileSync(artifact.manifest, "utf8"));
    if (
      JSON.stringify(existing.input) !== JSON.stringify(artifact.input) ||
      hash(readFileSync(artifact.binary)) !== existing.binarySha256
    )
      throw new Error(
        "existing native meter artifact corrupt; preserve for review"
      );
  } else {
    renameSync(binary, artifact.binary);
    atomicJson(artifact.manifest, { input: artifact.input, binarySha256 });
  }
  console.log(
    `native-process-meter build input=${hash(JSON.stringify(artifact.input))} binary=${hash(readFileSync(artifact.binary))}`
  );
  return artifact;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  buildProcessMeter();
