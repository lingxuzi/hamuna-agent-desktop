// 自适应替换 src-tauri/icons 下所有 PNG 为新 logo 的 sharp 缩放版本。
// 源：hamuna-web-logo.png（40×40 PNG）
// 行为：读每个目标 PNG 的像素尺寸 → sharp resize 源 PNG 到该尺寸 → 覆盖。
// ICO/ICNS 容器保持原样（多分辨率容器，sharp 生成的多尺寸 PNG 嵌入质量差）。

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = "/home/hmcz/Projects/hamuna-agent-desktop/src-tauri/icons";
const SRC = "/home/hmcz/Projects/hamuna-agent-desktop/src/renderer/assets/brand/hamuna-web-logo.png";

// 二进制容器，跳过（用 sharp 的 toContainer 重新生成）
const SKIP = new Set(["icon.icns", "icon.ico"]);

const srcBuf = await readFile(SRC);

async function getPngSize(buf) {
  // IHDR 在偏移 16，宽 4B（BE），高 4B（BE）
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error("not PNG");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

const entries = await readdir(ROOT);
const replaced = [];
const skipped = [];

for (const name of entries) {
  if (!name.endsWith(".png")) continue;
  const full = path.join(ROOT, name);
  const st = await stat(full);
  if (!st.isFile()) continue;
  if (name.startsWith(".")) continue;
  if (SKIP.has(name)) {
    skipped.push(`${name} (binary container)`);
    continue;
  }
  const buf = await readFile(full);
  let size;
  try { size = await getPngSize(buf); } catch { skipped.push(`${name} (unreadable)`); continue; }
  if (size.w === 40 && size.h === 40 && name === "hamuna-web-logo.png") {
    skipped.push(`${name} (source)`);
    continue;
  }
  const out = await sharp(srcBuf)
    .resize(size.w, size.h, { fit: "contain", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(full, out);
  replaced.push(`${name} ${size.w}x${size.h} (${st.size} -> ${out.length})`);
}

console.log(`replaced ${replaced.length}, skipped ${skipped.length}`);
for (const r of replaced) console.log("  ✓", r);
for (const s of skipped) console.log("  -", s);