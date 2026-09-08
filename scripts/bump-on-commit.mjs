#!/usr/bin/env node
/**
 * 每次 commit 自动 bump patch 版本号（由 .git/hooks/pre-commit 调用）。
 *
 * 语义：本地提交即 bump，保证版本始终前进，不会因本地/CI 双写者而跳回旧值。
 *
 * 为什么用 pre-commit 而不是 prepare-commit-msg：
 *   prepare-commit-msg 阶段 git add 的文件不保证进当前 commit（实测：commit 会漏掉
 *   版本文件，bump 与内容分离）。pre-commit 运行后 git 才从 index 生成 tree，
 *   所以 pre-commit 里 git add 的版本文件会正确进入本次 commit。
 *
 * 必须跳过的场景（否则灾难）：
 *  1. CI 环境（$GITHUB_ACTIONS=true）——CI 的 windows-release workflow 自己 bump + commit，
 *     hook 再 bump 会让版本跳 2。
 *  2. 版本文件已在 index 中（用户已显式 `npm version`，或本地 release 流程）——
 *     此时版本是用户主动的，hook 不重复 bump。判断：index 里 package.json 的 version
 *     != HEAD 里 package.json 的 version。
 *
 * 版本同步：`npm version patch --no-git-tag-version` 触发 package.json 的 version 钩子
 * （scripts/sync-version.js 同步 tauri.conf.json + Cargo.toml）。--no-git-tag-version 不建 tag；
 * .npmrc 已设 git-tag-version=false，本脚本显式再传一份双保险。
 * 注意：version 钩子只 git add 了 conf + Cargo，package.json / package-lock.json 需手动 add。
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// ---- 跳过条件 1：CI ----
if (process.env.GITHUB_ACTIONS === 'true') {
  process.exit(0);
}

// ---- 跳过条件 2：版本已被用户主动改动（工作树 package.json != HEAD） ----
// npm version 只改工作树（钩子只 git add conf+Cargo），index 里 package.json 仍是 HEAD 版本。
// 所以读「工作树文件」而不是「git show :package.json」(index)。用户显式 npm version 后
// 工作树版本 != HEAD → 跳过，尊重用户主动 bump；正常 commit 工作树版本 == HEAD → bump。
try {
  const wcPkg = readFileSync('package.json', 'utf8');
  const headPkg = execSync('git show HEAD:package.json', { encoding: 'utf8' });
  const wcVersion = JSON.parse(wcPkg).version;
  const headVersion = JSON.parse(headPkg).version;
  if (wcVersion !== headVersion) {
    // 用户已把新版本改进了工作树（例如跑过 npm version）——尊重它，不再 bump
    process.exit(0);
  }
} catch {
  // HEAD:package.json 不存在（首次 commit 无 HEAD）——正常 bump 路径
}

// ---- 真正 bump ----
try {
  execSync('npm version patch --no-git-tag-version', {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  execSync('git add package.json package-lock.json', { stdio: 'inherit', cwd: process.cwd() });
} catch (err) {
  // npm version 失败（例如版本文件只读）——不阻塞提交，打印告警
  process.stderr.write(`[bump-on-commit] 版本 bump 失败，跳过: ${err.message}\n`);
  process.exit(0);
}

// ---- SYSTEM_SKILLS_VERSION 自动 bump（creative-video-suite 改动触发，A5 拍板） ----
// 背景：creative-video-suite 在 v40 promote 为 system skill（commands.rs:1371 + src/server/index.ts:1419）。
// 用户拍板 A5（严格自动 + 接受爆炸）：每次 commit creative-video-suite 改动 → SYSTEM_SKILLS_VERSION +1
// → 全量 system skill 重下载（含 memory / hamuna-cli / tool-creator / 等无关项）。
//
// 双源同步：commands.rs::SYSTEM_SKILLS_VERSION (Rust) + systemSkills.ts::SYSTEM_SKILLS_VERSION (Node)。
// 跳过条件：用户已主动改（wcVer != headVer）、非 creative-video-suite 改动、CI、版本字段未匹配。
try {
  const stagedCv = execSync(
    'git diff --cached --name-only -- bundled-skills/creative-video-suite/',
    { encoding: 'utf8' }
  ).trim();
  if (stagedCv) {
    const wcCmd = readFileSync('src-tauri/src/commands.rs', 'utf8');
    const headCmd = execSync('git show HEAD:src-tauri/src/commands.rs', { encoding: 'utf8' });
    const wcVer = wcCmd.match(/const SYSTEM_SKILLS_VERSION: &str = "(\d+)";/)?.[1];
    const headVer = headCmd.match(/const SYSTEM_SKILLS_VERSION: &str = "(\d+)";/)?.[1];
    if (wcVer && headVer && wcVer === headVer) {
      const nextVer = String(Number(wcVer) + 1);
      const nextCmd = wcCmd.replace(
        /const SYSTEM_SKILLS_VERSION: &str = "\d+";/,
        `const SYSTEM_SKILLS_VERSION: &str = "${nextVer}";`
      );
      writeFileSync('src-tauri/src/commands.rs', nextCmd);
      const wcTs = readFileSync('src/shared/systemSkills.ts', 'utf8');
      const nextTs = wcTs.replace(
        /export const SYSTEM_SKILLS_VERSION = '\d+';/,
        `export const SYSTEM_SKILLS_VERSION = '${nextVer}';`
      );
      writeFileSync('src/shared/systemSkills.ts', nextTs);
      execSync('git add src-tauri/src/commands.rs src/shared/systemSkills.ts', {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      process.stderr.write(`[bump-on-commit] SYSTEM_SKILLS_VERSION ${wcVer} → ${nextVer}\n`);
    }
  }
} catch (err) {
  process.stderr.write(`[bump-on-commit] SYSTEM_SKILLS_VERSION bump 失败，跳过: ${err.message}\n`);
}
