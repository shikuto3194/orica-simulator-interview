import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(
  new URL("../apps/playground-web/package.json", import.meta.url)
);
const sharp = require("sharp");
const source = new URL(
  "../apps/playground-web/src/assets/icon.png",
  import.meta.url
);
const publicDir = new URL("../apps/playground-web/public/", import.meta.url);
const background = "#0d0e1a";

// Keep the chosen original unchanged; these are delivery sizes only.
for (const size of [192, 512]) {
  await sharp(fileURLToPath(source))
    .resize(size, size, { fit: "contain", background: "#00000000" })
    .png()
    .toFile(fileURLToPath(new URL(`pwa-${size}.png`, publicDir)));
}

await sharp(fileURLToPath(source))
  .resize(180, 180, { fit: "contain", background })
  .flatten({ background })
  .png()
  .toFile(fileURLToPath(new URL("apple-touch-icon.png", publicDir)));

// 96px padding keeps this original's visible pixels inside the mask safe circle.
const maskableContent = await sharp(fileURLToPath(source))
  .resize(320, 320, { fit: "contain", background: "#00000000" })
  .png()
  .toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background } })
  .composite([{ input: maskableContent, gravity: "centre" }])
  .removeAlpha()
  .png()
  .toFile(fileURLToPath(new URL("pwa-maskable-512.png", publicDir)));

console.log(
  "Updated browser, Apple touch, and PWA icons from src/assets/icon.png"
);
