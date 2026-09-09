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

// ---- SKILL_VERSION auto-bump（bundled-skills/creative-video-suite/SKILL.md frontmatter） ----
// 背景：用户拍板"每次更新 creative-video-suite skill 自动更新 skill 内版本号"（2026-09-09）→
// bump-on-commit.mjs 扩展 SKILL frontmatter version 同步。scope 暂限 creative-video-suite：其它 skill 的
// frontmatter version 格式不统一：
//   - prompt-writer:        `version: 20260707`（日期格式，Number() + 1 语义错）
//   - hamuna-strategy-v2:   `version: 20260818`（同上）
//   - agent-browser:        `version: 1` 在 SKILL.md body（非 frontmatter，regex 不匹配）
// 扩展前 MUST 先统一版本格式策略（独立 PR，本任务不做）。
//
// 触发条件：staged `bundled-skills/creative-video-suite/` 任意文件（含 references/* 改动）→ bump
// SKILL.md frontmatter `version: "X"` → `version: "X+1"`（数字字符串格式，与 SYSTEM_SKILLS_VERSION
// auto-bump 同 design pattern；A 路径选择，外部 consumer 漏读 bump 不报错）。
//
// 跳过条件：
//   1. CI（GITHUB_ACTIONS=true）—— 上文已 process.exit(0) 提前 return
//   2. 用户主动改 SKILL.md（wcSkill !== headSkill）—— 尊重，完整文件 diff 由用户控制
//   3. wcVersion !== headVersion（用户主动 bump 了 frontmatter version）—— 尊重
//   4. version 字段未匹配（regex miss / 格式漂移）—— 静默跳过
try {
  const stagedSkill = execSync(
    'git diff --cached --name-only -- bundled-skills/creative-video-suite/',
    { encoding: 'utf8' }
  ).trim();
  if (stagedSkill) {
    const skillPath = 'bundled-skills/creative-video-suite/SKILL.md';
    const wcSkill = readFileSync(skillPath, 'utf8');
    const wcVerMatch = wcSkill.match(/^version:\s*"(\d+)"\s*$/m);
    if (wcVerMatch) {
      let headVer = null;
      try {
        const headSkill = execSync(`git show HEAD:${skillPath}`, { encoding: 'utf8' });
        const headVerMatch = headSkill.match(/^version:\s*"(\d+)"\s*$/m);
        if (headVerMatch) headVer = headVerMatch[1];
      } catch {
        // 首次 commit 无 HEAD — 默认 bump
      }
      if (!headVer || wcVerMatch[1] === headVer) {
        const nextVer = String(Number(wcVerMatch[1]) + 1);
        const nextSkill = wcSkill.replace(
          /^version:\s*"\d+"\s*$/m,
          `version: "${nextVer}"`,
        );
        writeFileSync(skillPath, nextSkill);
        execSync(`git add ${skillPath}`, { stdio: 'inherit', cwd: process.cwd() });
        process.stderr.write(`[bump-on-commit] creative-video-suite version ${wcVerMatch[1]} → ${nextVer}\n`);
      }
      // else: wcVer !== headVer, 用户主动 bump, 尊重
    }
    // else: version 字段未匹配（格式漂移）, 静默跳过
  }
} catch (err) {
  process.stderr.write(`[bump-on-commit] SKILL_VERSION bump 失败，跳过: ${err.message}\n`);
}

// ---- AGNES_MCP_VERSION auto-bump（PyPI latest → mcp.json pin） ----
// 背景：multimedia-creator MCP（extended_buildin_mcp/mcp.json）依赖 agnes-video-25-mcp PyPI 包，
// 原始 pin ==0.1.4；用户拍板「Build-time / pre-commit hook auto-bump」——每次 commit 查 PyPI latest，
// mismatch 则 patch mcp.json 的 --from arg；与 SYSTEM_SKILLS_VERSION auto-bump 同模式。
//
// 跳过条件：
//  1. CI（GITHUB_ACTIONS=true）—— 上文已 process.exit(0) 提前 return
//  2. 用户主动改 mcp.json（wcMcp !== headMcp）——尊重用户的 pin 手动选择 / 回退
//  3. PyPI 不可达 / 超时（5s AbortSignal.timeout）——不阻塞 commit，stderr 告警即可
//  4. mcp.json 未匹配 pin 格式（regex miss）——大概率是用户手改了结构，跳过
//
// 为什么用 top-level await：fetch 是 async API；.mjs 在 Node 13+ 支持 top-level await，
// 项目 Node v24 满足。整段包 try/catch，任何子步骤失败都只 stderr 不 exit(1)。
//
// 代价：开发者必须 commit 才会触发 → 老用户必须升级 App 才拿到新 pin（与 system skill 模式一致）。
//   如需"已安装用户也 auto-upgrade"，需要走 App 启动期 check + ~/.hamuna/ mirror（更重，本任务不做）。
try {
  const wcMcp = readFileSync('extended_buildin_mcp/mcp.json', 'utf8');
  const headMcp = execSync('git show HEAD:extended_buildin_mcp/mcp.json', { encoding: 'utf8' });
  if (wcMcp === headMcp) {
    const resp = await fetch('https://pypi.org/pypi/agnes-video-25-mcp/json', {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      process.stderr.write(`[bump-on-commit] PyPI 返回 ${resp.status}, 跳过 AGNES_MCP auto-bump\n`);
    } else {
      const data = await resp.json();
      const latest = data.info.version;
      const pinMatch = wcMcp.match(/agnes-video-25-mcp==(\d+\.\d+\.\d+)/);
      if (!pinMatch) {
        process.stderr.write('[bump-on-commit] mcp.json 未匹配 pin 格式 agnes-video-25-mcp==X.Y.Z, 跳过\n');
      } else if (pinMatch[1] !== latest) {
        const newMcp = wcMcp.replace(
          /agnes-video-25-mcp==\d+\.\d+\.\d+/,
          `agnes-video-25-mcp==${latest}`,
        );
        writeFileSync('extended_buildin_mcp/mcp.json', newMcp);
        execSync('git add extended_buildin_mcp/mcp.json', { stdio: 'inherit', cwd: process.cwd() });
        process.stderr.write(`[bump-on-commit] AGNES_MCP auto-bumped: ${pinMatch[1]} → ${latest}\n`);
      }
      // else: pinMatch[1] === latest, 已是最新, 静默跳过
    }
  }
  // else: wcMcp !== headMcp, 用户主动改过, 尊重
} catch (err) {
  process.stderr.write(`[bump-on-commit] AGNES_MCP check 失败, 跳过: ${err.message}\n`);
}
