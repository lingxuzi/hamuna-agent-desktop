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
 *
 * SYSTEM_SKILLS_VERSION 现在是手动 bump 常量：
 *   - SYSTEM_SKILLS 列表本身已由 `scripts/generate-system-skills.mjs` 从
 *     `bundled-skills/<name>/SKILL.md` 自动 derive（见 commands.rs / systemSkills.ts
 *     注释），不需要按目录改动自动 bump。
 *   - orphan cleanup 走 `~/.hamuna/.system-skills-snapshot.json` 增量检测，跟版本号
 *     解耦 —— 删一个 bundled 目录后下次 launch 自动删用户机器对应目录，无需 bump。
 *   - SYSTEM_SKILLS_VERSION 仍在「SKILL.md 内容变更 → 必须 force-overwrite 所有
 *     14+ system skill 的 content」场景下手动 bump（与之前一致）。
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

// ---- AGNES_MCP_VERSION auto-bump（PyPI latest → hosted_mcps/.../pyproject.toml pin） ----
// 背景：multimedia-creator MCP（extended_buildin_mcp/mcp.json）依赖 agnes-video-25-mcp PyPI 包，
// user 拍板 mcp.json 维持 bare `command` 不持 pin (我们 ship `pip install --target` 产物,
// 不写 wrapper script, MCP spawn 靠 PATH 查找). pin 单一事实源改为
// hosted_mcps/agnes-video-25/pyproject.toml::version (与 windows NSIS 同款).
// 每次 commit 查 PyPI latest, mismatch 则 patch pyproject.toml.
//
// 跳过条件：
//  1. CI（GITHUB_ACTIONS=true）—— 上文已 process.exit(0) 提前 return
//  2. 用户主动改 pyproject（wcPy !== headPy）——尊重用户的 pin 手动选择 / 回退
//  3. PyPI 不可达 / 超时（5s AbortSignal.timeout）——不阻塞 commit，stderr 告警即可
//  4. pyproject.toml 不存在（rare, hosted_mcps 还没 checkout）——静默跳过
//  5. pyproject version 字段未匹配（regex miss）——大概率是用户手改了结构，跳过
//
// 为什么用 top-level await：fetch 是 async API；.mjs 在 Node 13+ 支持 top-level await，
// 项目 Node v24 满足。整段包 try/catch，任何子步骤失败都只 stderr 不 exit(1)。
//
// 代价：开发者必须 commit 才会触发 → 老用户必须升级 App 才拿到新 pin（与 system skill 模式一致）。
//   如需"已安装用户也 auto-upgrade"，需要走 App 启动期 check + ~/.hamuna/ mirror（更重，本任务不做）。
try {
  const PYPROJECT_PATH = 'hosted_mcps/agnes-video-25/pyproject.toml';
  const wcPy = readFileSync(PYPROJECT_PATH, 'utf8');
  const headPy = execSync(`git show HEAD:${PYPROJECT_PATH}`, { encoding: 'utf8' });
  if (wcPy === headPy) {
    const resp = await fetch('https://pypi.org/pypi/agnes-video-25-mcp/json', {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      process.stderr.write(`[bump-on-commit] PyPI 返回 ${resp.status}, 跳过 AGNES_MCP auto-bump\n`);
    } else {
      const data = await resp.json();
      const latest = data.info.version;
      const pinMatch = wcPy.match(/^version\s*=\s*"([^"]+)"/m);
      if (!pinMatch) {
        // pyproject.toml version 字段未匹配（格式漂移）, 静默跳过, 不阻塞 commit.
        process.stderr.write(
          `[bump-on-commit] ${PYPROJECT_PATH} 未匹配 version 字段, 跳过 AGNES_MCP auto-bump (PyPI latest=${latest})\n`,
        );
      } else if (pinMatch[1] !== latest) {
        const newPy = wcPy.replace(
          /^version\s*=\s*"\d+\.\d+\.\d+"/m,
          `version = "${latest}"`,
        );
        writeFileSync(PYPROJECT_PATH, newPy);
        execSync(`git add ${PYPROJECT_PATH}`, { stdio: 'inherit', cwd: process.cwd() });
        process.stderr.write(`[bump-on-commit] AGNES_MCP auto-bumped: ${pinMatch[1]} → ${latest} (in ${PYPROJECT_PATH})\n`);
      }
      // else: pinMatch[1] === latest, 已是最新, 静默跳过
    }
  }
  // else: wcPy !== headPy, 用户主动改过, 尊重
} catch (err) {
  // ENOENT (pyproject 缺失) 走这里. 静默跳过, 不阻塞 commit.
  process.stderr.write(`[bump-on-commit] AGNES_MCP check 跳过: ${err.message.split('\n')[0]}\n`);
}
