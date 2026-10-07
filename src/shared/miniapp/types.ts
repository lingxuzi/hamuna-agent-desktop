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
    /**
     * 声明保留，当前**不参与判定**。
     *
     * 它曾经被写成"该 MiniApp 允许 agent 触达的工作区路径前缀；空 = 不允许任何
     * 工作区工具" —— 那是错的，而且错在安全方向上：没有声明 `workspace_scope`
     * 的 app 照样拿得到一个**带工具**的 agent，只是 cwd 被硬钉在自己的 appdata
     * 里。真正的收窄发生在两处，都与本字段无关：
     * `miniapp-app-dispatch.ts::resolveAgentWorkspace` 把 workspace 强制落在
     * appdata 内（理由见该处注释：agent 有工具，放开目录外就是任意文件写），再由
     * `appDataWorkspace` 在 appdata **之内**收窄一层。
     *
     * 留着一个不生效的字段不是疏忽：将来"用户显式授权某个目录"要有可信的授权
     * 记录来源才能开，而空开等于没有。SKILL.md 对作者的说法（"声明保留但当前不
     * 放开"）是准确的；这里曾经是唯一说错的地方，而说错的是**类型定义** ——
     * 下一个加判定的人正是照着它判断这字段是否已被强制。
     */
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
  /**
   * 主题绑定方式。缺省 = `'host'`，行为与加这个字段之前完全一致。
   *
   * `'bespoke'` 是给"调色板本身就是产品内容"的应用开的口子：塔罗、夜景仪表盘、
   * 品牌色看板这类应用如果被迫走宿主 token，就只能把"夜色"表达成 `text-muted`
   * 画的星点、`accent` 画的铜金 —— 切到浅色主题时整屏浅底浅字、星点消失。
   * 于是模型在"用 token"和"有辨识度"之间二选一，两边都输。
   *
   * 这里给的出口是**换掉注入的值，而不是换掉变量名**：CSS 侧仍然只写
   * `var(--hamuna-bg-primary)`，宿主只是把契约里那几个槽位填成作者声明的颜色。
   * 于是作者拿到的仍然是那 43 个变量（审计照常跑）、`var()` 的 fallback 仍然
   * 等于自己声明的调色板（导出成独立网页还是原来那个样子）、换主题仍然自动
   * 跟随 —— 区别只是"跟随谁"由作者说了算。
   */
  appearance?: MiniAppAppearance;
}

/**
 * `meta.json::appearance`。
 *
 * `palette` 的键是契约变量名去掉 `--hamuna-` 前缀（`bg-primary`、`accent`…），
 * 值必须是字面颜色 —— 不接受 `var(--hamuna-*)` 引用，因为 bespoke 的意义正是
 * 不依赖宿主的值；接受引用会让"自持"退化成"换一种方式依赖宿主"。
 */
export interface MiniAppAppearance {
  mode: 'host' | 'bespoke';
  /** 浅色外观下覆盖契约槽位的颜色。`mode: 'bespoke'` 时必填。 */
  palette?: Record<string, string>;
  /** 深色外观下的覆盖；缺省时深浅共用 `palette`。 */
  palette_dark?: Record<string, string>;
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