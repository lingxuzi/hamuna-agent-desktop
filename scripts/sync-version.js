/**
 * 同步版本号到 Tauri 配置文件
 * 由 npm version 钩子自动调用
 *
 * 数据源: package.json (单一数据源)
 * 同步目标: src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock
 *
 * Cargo.lock 必须一起改：CI 跑 `cargo test --locked`，而 --locked 在 lock 文件
 * 与 Cargo.toml 的包版本不一致时会直接失败（"needs to be updated but --locked
 * was passed"）。只改 Cargo.toml 时本地 cargo 会静默更新 lock，所以这个缺陷在
 * 本地看不出来，只在 CI 上表现为整条 Rust gate 红掉，而且每个 commit 都红。
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 读取 package.json 的版本号
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;

// 校验版本号格式 (semver: x.y.z)
if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`错误: 版本号格式无效 "${version}"，应为 x.y.z`);
    process.exit(1);
}

console.log(`同步版本号: ${version}`);

// 更新 tauri.conf.json
const tauriConfPath = join(rootDir, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf-8');
console.log('  ✓ src-tauri/tauri.conf.json');

// 更新 Cargo.toml
const cargoPath = join(rootDir, 'src-tauri/Cargo.toml');
let cargoContent = readFileSync(cargoPath, 'utf-8');
cargoContent = cargoContent.replace(
    /^version = "[0-9]+\.[0-9]+\.[0-9]+"/m,
    `version = "${version}"`
);
writeFileSync(cargoPath, cargoContent, 'utf-8');
console.log('  ✓ src-tauri/Cargo.toml');

// 更新 Cargo.lock 里本包的 version 条目。只认紧跟在 `name = "<package>"` 之后
// 的那个 version，避免撞到任意依赖的同名行。package 名以 Cargo.toml 为准。
const packageName = (cargoContent.match(/^name = "([^"]+)"/m) || [])[1];
const cargoLockPath = join(rootDir, 'src-tauri/Cargo.lock');
if (!packageName) {
    console.error('错误: 无法从 src-tauri/Cargo.toml 读出 package name，Cargo.lock 未同步');
    process.exit(1);
}
let lockContent = readFileSync(cargoLockPath, 'utf-8');
const lockEntry = new RegExp(
    `(\\[\\[package\\]\\]\\nname = "${packageName}"\\nversion = ")[0-9]+\\.[0-9]+\\.[0-9]+(")`
);
if (!lockEntry.test(lockContent)) {
    console.error(`错误: src-tauri/Cargo.lock 里找不到 ${packageName} 的 package 条目`);
    process.exit(1);
}
lockContent = lockContent.replace(lockEntry, `$1${version}$2`);
writeFileSync(cargoLockPath, lockContent, 'utf-8');
console.log('  ✓ src-tauri/Cargo.lock');

console.log(`\n版本号已同步到 ${version}`);
