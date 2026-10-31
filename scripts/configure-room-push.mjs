import { readFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";
const require = createRequire(
  new URL("../apps/playground-web/package.json", import.meta.url)
);
const webpush = require("web-push");
const envPath = new URL("../apps/playground-web/.env", import.meta.url);
const env = readFileSync(envPath, "utf8");
const names = [
  "WEB_PUSH_PUBLIC_KEY",
  "WEB_PUSH_PRIVATE_KEY",
  "WEB_PUSH_SUBJECT",
];
const present = names.map((name) => new RegExp(`^${name}=.+$`, "m").test(env));
if (present.every(Boolean)) {
  console.log("Web Push configuration already exists; keys preserved.");
} else if (present.some(Boolean)) {
  throw new Error(
    "Partial Web Push configuration exists. Complete it without rotating existing keys."
  );
} else {
  const keys = webpush.generateVAPIDKeys();
  appendFileSync(
    envPath,
    `\nWEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_PRIVATE_KEY=${keys.privateKey}\nWEB_PUSH_SUBJECT=https://gentle-heliotrope-e31174.netlify.app\n`,
    { mode: 0o600 }
  );
  console.log(
    "Web Push keys saved to the ignored server environment file. No key material was logged."
  );
}
