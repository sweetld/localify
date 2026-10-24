// Rasterize build/icon.svg into the PNGs electron-builder needs.
//   build/icon.png       1024px master (electron-builder derives .ico / .icns)
//   build/icons/NxN.png  hicolor sizes for the Linux desktop entry
// Run with `npm run icons` after editing the SVG; the outputs are committed.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "build/icon.svg"));
const render = (size) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

writeFileSync(join(root, "build/icon.png"), render(1024));
mkdirSync(join(root, "build/icons"), { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  writeFileSync(join(root, `build/icons/${size}x${size}.png`), render(size));
}
console.log("icons written to build/");
