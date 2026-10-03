/**
 * MiniApp 共享类型（PRD v0.4 §B.1 #4）。
 * Phase 0 子集：metadata + storage + 4 类权限。
 */

import type { MiniAppResponse } from './errors';

/** Phase 0 4 类权限（不含 node/agent/chat，Phase 2 补）。 */
export interface MiniAppPermissions {
  fs?: {
    read?: string[];
    write?: string[];
  };
  shell?: {
    allow?: string[];
  };
  /**
   * 系统剪贴板。与 `dialog` 同属「宿主 UI 能力」那一档，但**不能**跟着
   * `dialog` 一起无条件放行：剪贴板里通常就是用户刚从密码管理器复制的密码。
   * 一个 `permissions: {}` 的 MiniApp 读得到剪贴板、又能 `net.fetch` 外发，
   * 就是一条现成的凭据外泄路径，所以它必须像 `ai` / `agent` 一样显式 opt-in。
   */
  clipboard?: {
    enabled?: boolean;
  };
  net?: {
    allow?: string[];
  };
  /**
   * Worker resource envelope. Only meaningful for `kind: 'worker'`; the
   * worker pool reads these instead of hardcoding a ceiling, so a MiniApp
   * author can widen or tighten their own footprint per app. Absent fields
   * fall back to the pool defaults (64MB old-gen / 5s call timeout).
   */
  node?: {
    enabled?: boolean;
    max_memory_mb?: number;
    timeout_ms?: number;
  };
  ai?: {
    enabled?: boolean;
    /**
     * 显式可用的 model 名单（支持 `'*'` 通配）。判定**只针对作者在调用里显式
     * 传入的 `model`**：传了就必须命中，没传则整段判定不参与，最终用宿主当前
     * 配置的模型。
     *
     * 所以它是"点名要用的模型"的上限，不是"最终落到哪个模型"的上限。想要一个
     * 真正封死的模型集合，调用时必须显式写 `model`。
     */
    allowed_models?: string[];
    max_tokens_per_request?: number;
    rate_limit_per_minute?: number;
  };
  /**
   * MiniApp 自有隐藏 Agent 会话（`app.agent.*`）。与 `ai` 分开是因为粒度不同：
   * `ai` 是"问一句拿一句"，无状态、无工具；`agent` 会派生一个真实的 Sidecar
   * Session（1:1 进程），能读写工作区、跑工具，成本与逃逸面都高一档，所以必须
   * 显式 opt-in 而不能被 `ai.enabled` 顺带带出来。
   */
  agent?: {
    enabled?: boolean;
    /** 该 MiniApp 允许 agent 触达的工作区路径前缀；空 = 不允许任何工作区工具。 */
    workspace_scope?: string[];
  };
}

/**
 * Per-locale overrides for the three user-facing strings. Whichever fields are
 * present override the top-level `name` / `description` / `tags`; a missing
 * field falls back to the top-level value, so an app can translate just its
 * name and leave everything else alone.
 */
export interface MiniAppLocaleStrings {
  name?: string;
  description?: string;
  tags?: string[];
}

/**
 * `meta.json::i18n`. Keys are locale ids (`zh-CN`, `en-US`, …). Resolution and
 * the fallback chain live in `./localize.ts` — the Marketplace renders through
 * it so the host locale drives what the user sees without any MiniApp code.
 */
export interface MiniAppI18n {
  locales: Record<string, MiniAppLocaleStrings>;
}

/**
 * One entry of `meta.json::dependencies`. The host turns it into a
 * `<script src>` or `<link rel=stylesheet>` inside the iframe.
 */
export interface MiniAppDependency {
  url: string;
  type: 'script' | 'style';
}

/** `meta.json` schema（PRD v0.3 §2.1.1，Phase 0 子集）。 */
export interface MiniAppMetadata {
  id: string;
  name: string;
  description: string;
  icon: string;
  category:
    | 'developer'
    | 'design'
    | 'productivity'
    | 'data'
    | 'media'
    | 'game'
    | 'education'
    | 'social'
    | 'finance'
    | 'other';
  tags?: string[];
  /**
   * Phase 2 (PRD v0.4 §B.3) — Skill subset this MiniApp pulls into its
   * Sidecar session. Validated by `meta-schema.ts` to be ≤ 5 entries drawn
   * from `bundled-skills/` (excluding `bundled-agents/hamuna_helper`).
   * Phase 2 v0.4 stores the declarations only; the actual reload helper
   * lives in `src/server/utils/skill-reload.ts::evaluateSkillReloadForMiniApp`.
   */
  skills?: string[];
  /**
   * Phase 3 (PRD v0.4 §B.4): MiniApp execution kind.
   *   - 'iframe' (default): runs entirely inside the iframe sandbox, no Node
   *     side. CSP + postMessage trust rules apply. (Phase 0/1/2 behavior.)
   *   - 'worker': host spawns a Node `worker_threads` instance + shimmed
   *     require() for shell/git/fs access beyond the iframe. Worker methods
   *     are listed in `meta.worker_kind` → `bundled-miniapps/<id>/meta.json`.
   */
  kind?: 'iframe' | 'worker';
  /**
   * Phase 3: required when `kind === 'worker'`. Maps to a registered worker
   * kind in `src/server/miniapp-worker/worker-rpc.ts::getKindDef`. Phase 3
   * only registers `'git-graph'`; Phase 4 will generalize via a registry.
   */
  worker_kind?: string;
  /**
   * Third-party CDN assets (script / stylesheet) the host injects into the
   * iframe. The iframe CSP is `default-src 'none'`, so without an explicit
   * declaration a MiniApp author literally cannot load fabric / monaco /
   * chart.js — the API surface exists but has no way to be used.
   *
   * Every host MUST also appear in `permissions.net.allow`; the host only
   * widens the CSP for already-granted hosts, so this field can never grant
   * more network access than the author already asked for.
   */
  dependencies?: MiniAppDependency[];
  version: number;
  created_at?: number;
  updated_at?: number;
  min_host_version: string;
  permissions: MiniAppPermissions;
  /** Optional per-locale overrides for `name` / `description` / `tags`. */
  i18n?: MiniAppI18n;
  /**
   * `storage.defaults` —— `app.storage.get(key)` 在键缺失时回落的初值。
   *
   * 只声明真正兑现的那一半。`storage.file` 曾被 SKILL.md 标成"必填"，但宿主
   * 恒定写 <appdata>/storage.json，从来没读过这个键：把它放进类型只会让
   * "类型里有"和"运行时有用"彻底脱钩。持久化文件名是安全边界 —— 免权限的
   * API 不该由作者决定落哪个文件，恒定比可配更正确。
   */
  storage?: { defaults?: Record<string, unknown> };
  ai_context?: string | null;
}

/** `storage.json` 形态（PRD v0.4 §5.12 + v0.3 §6.4）。 */
export type MiniAppStorage = Record<string, unknown>;

/** MiniApp 安装目录结构（PRD v0.3 §2.1）。 */
export interface MiniAppSource {
  appId: string;
  rootPath: string;
  meta: MiniAppMetadata;
}

/** invoke 通用入参/出参。 */
export type MiniAppInvokeResult<T> = MiniAppResponse<T>;