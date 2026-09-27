// 自适应生成 icon.icns / icon.ico。
// ICNS 用原生格式（macOS 不需要 sips）；ICO 用 png-to-ico。
// 源：hamuna-web-logo.png（40×40 PNG）

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { default: pngToIco } = require("/tmp/icns-tools/node_modules/png-to-ico");

const ROOT = "/home/hmcz/Projects/hamuna-agent-desktop/src-tauri/icons";
const SRC = "/home/hmcz/Projects/hamuna-agent-desktop/src/renderer/assets/brand/hamuna-web-logo.png";

// macOS ICNS chunk 类型 → 像素尺寸。
const ICNS_TYPES = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  // @2x 变体（小尺寸高 DPI）：macOS 会自动选；不常用，省略避免体积翻倍。
};

// ICO 通用尺寸
const ICO_SIZES = [16, 32, 48, 64, 128, 256, 512];

const srcBuf = await readFile(SRC);

async function pngAt(size) {
  return sharp(srcBuf)
    .resize(size, size, { fit: "contain", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

// === ICO ===
const icoSized = await Promise.all(ICO_SIZES.map(async s => pngAt(s)));
const icoBuf = await pngToIco(icoSized);
await writeFile(path.join(ROOT, "icon.ico"), icoBuf);
console.log(`✓ icon.ico (${icoBuf.length} bytes, sizes: ${ICO_SIZES.join(",")})`);

// === ICNS ===
const chunks = [];
for (const [type, size] of Object.entries(ICNS_TYPES)) {
  const png = await pngAt(size);
  const len = 8 + png.length;
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(len, 4);
  chunks.push(header, png);
}
const icnsLen = 8 + chunks.reduce((n, b) => n + b.length, 0);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(icnsLen, 4);
const icnsBuf = Buffer.concat([icnsHeader, ...chunks], icnsLen);
await writeFile(path.join(ROOT, "icon.icns"), icnsBuf);
console.log(`✓ icon.icns (${icnsBuf.length} bytes, types: ${Object.keys(ICNS_TYPES).join(",")})`);