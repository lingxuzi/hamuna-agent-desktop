/**
 * MiniApp `meta.json` schema validator（PRD v0.4 §B.1 #1 + PRD v0.3 §2.1.1）。
 *
 * 权限组：fs/shell/net/node/ai/agent。**不**含 chat（聊天由宿主 Tab 承担）。
 * 手动 validator 模式（与 `src/shared/mcpConfig.ts` 同款 pattern；shared/
 * 禁顶层 import zod —— 见 CLAUDE.md §Pit-of-Success builtin MCP 懒加载）。
 */

import { err, ok, type MiniAppResponse } from './errors';
import { validatePathTemplatePrefix } from './path-templates';
import type {
  MiniAppAppearance,
  MiniAppDependency,
  MiniAppI18n,
  MiniAppMetadata,
  MiniAppPermissions,
} from './types';
import { hostAllowed } from './app-permissions';
import appearanceContract from '../miniapp-appearance/contract.json';

const KNOWN_CATEGORIES = new Set<MiniAppMetadata['category']>([
  'developer',
  'design',
  'productivity',
  'data',
  'media',
  'game',
  'education',
  'social',
  'finance',
  'other',
]);

/** SemVer 字符串最小校验（Phase 0 仅校验 `x.y.z` 三段 + 全数字）。 */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;
}

function parsePermissions(raw: unknown): MiniAppPermissions | string {
  const r = asRecord(raw);
  if (!r) return 'permissions must be an object';

  const out: MiniAppPermissions = {};

  if (r.fs !== undefined) {
    const fs = asRecord(r.fs);
    if (!fs) return 'permissions.fs must be an object';
    const outFs: NonNullable<MiniAppPermissions['fs']> = {};
    if (fs.read !== undefined) {
      const arr = asStringArray(fs.read);
      if (!arr) return 'permissions.fs.read must be string[]';
      for (const p of arr) {
        const errMsg = validatePathTemplatePrefix(p);
        if (errMsg) return errMsg;
      }
      outFs.read = arr;
    }
    if (fs.write !== undefined) {
      const arr = asStringArray(fs.write);
      if (!arr) return 'permissions.fs.write must be string[]';
      for (const p of arr) {
        const errMsg = validatePathTemplatePrefix(p);
        if (errMsg) return errMsg;
      }
      outFs.write = arr;
    }
    out.fs = outFs;
  }

  if (r.shell !== undefined) {
    const sh = asRecord(r.shell);
    if (!sh) return 'permissions.shell must be an object';
    if (sh.allow !== undefined) {
      const arr = asStringArray(sh.allow);
      if (!arr) return 'permissions.shell.allow must be string[]';
      out.shell = { allow: arr };
    }
  }

  if (r.clipboard !== undefined) {
    const cb = asRecord(r.clipboard);
    if (!cb) return 'permissions.clipboard must be an object';
    if (cb.enabled !== undefined && typeof cb.enabled !== 'boolean') {
      return 'permissions.clipboard.enabled must be boolean';
    }
    out.clipboard = { enabled: cb.enabled === true };
  }

  if (r.net !== undefined) {
    const nt = asRecord(r.net);
    if (!nt) return 'permissions.net must be an object';
    if (nt.allow !== undefined) {
      const arr = asStringArray(nt.allow);
      if (!arr) return 'permissions.net.allow must be string[]';
      out.net = { allow: arr };
    }
  }

  if (r.node !== undefined) {
    const node = asRecord(r.node);
    if (!node) return 'permissions.node must be an object';
    const outNode: NonNullable<MiniAppPermissions['node']> = {};
    if (node.enabled !== undefined) {
      if (typeof node.enabled !== 'boolean') return 'permissions.node.enabled must be boolean';
      outNode.enabled = node.enabled;
    }
    if (node.max_memory_mb !== undefined) {
      if (typeof node.max_memory_mb !== 'number' || node.max_memory_mb < 16 || node.max_memory_mb > 512) {
        return 'permissions.node.max_memory_mb must be a number in [16, 512]';
      }
      outNode.max_memory_mb = node.max_memory_mb;
    }
    if (node.timeout_ms !== undefined) {
      if (typeof node.timeout_ms !== 'number' || node.timeout_ms < 1000 || node.timeout_ms > 60000) {
        return 'permissions.node.timeout_ms must be a number in [1000, 60000]';
      }
      outNode.timeout_ms = node.timeout_ms;
    }
    out.node = outNode;
  }

  if (r.ai !== undefined) {
    const ai = asRecord(r.ai);
    if (!ai) return 'permissions.ai must be an object';
    const outAi: NonNullable<MiniAppPermissions['ai']> = {};
    if (ai.enabled !== undefined) {
      if (typeof ai.enabled !== 'boolean') return 'permissions.ai.enabled must be boolean';
      outAi.enabled = ai.enabled;
    }
    if (ai.allowed_models !== undefined) {
      const arr = asStringArray(ai.allowed_models);
      if (!arr) return 'permissions.ai.allowed_models must be string[]';
      outAi.allowed_models = arr;
    }
    if (ai.max_tokens_per_request !== undefined) {
      const n = asNumber(ai.max_tokens_per_request);
      if (n === undefined) return 'permissions.ai.max_tokens_per_request must be number';
      outAi.max_tokens_per_request = n;
    }
    if (ai.rate_limit_per_minute !== undefined) {
      const n = asNumber(ai.rate_limit_per_minute);
      if (n === undefined) return 'permissions.ai.rate_limit_per_minute must be number';
      outAi.rate_limit_per_minute = n;
    }
    out.ai = outAi;
  }

  if (r.agent !== undefined) {
    const agent = asRecord(r.agent);
    if (!agent) return 'permissions.agent must be an object';
    const outAgent: NonNullable<MiniAppPermissions['agent']> = {};
    if (agent.enabled !== undefined) {
      if (typeof agent.enabled !== 'boolean') return 'permissions.agent.enabled must be boolean';
      outAgent.enabled = agent.enabled;
    }
    if (agent.workspace_scope !== undefined) {
      const arr = asStringArray(agent.workspace_scope);
      if (!arr) return 'permissions.agent.workspace_scope must be string[]';
      outAgent.workspace_scope = arr;
    }
    out.agent = outAgent;
  }

  return out;
}

/**
 * `i18n.locales[<locale-id>]` overrides. Locale keys are opaque (the host
 * decides what it can render); only the *values* are constrained, and they are
 * held to the same limits as the top-level fields so a translation cannot
 * smuggle in a 4KB description or a 40-tag list that the top level forbids.
 */
function parseI18n(raw: unknown): MiniAppI18n | string {
  const r = asRecord(raw);
  if (!r) return 'i18n must be an object';

  const locales = asRecord(r.locales);
  if (!locales) return 'i18n.locales must be an object';

  const out: MiniAppI18n = { locales: {} };
  for (const [locale, value] of Object.entries(locales)) {
    const strings = asRecord(value);
    if (!strings) return `i18n.locales["${locale}"] must be an object`;

    const entry: NonNullable<MiniAppI18n['locales'][string]> = {};
    if (strings.name !== undefined) {
      const name = asString(strings.name);
      if (!name) return `i18n.locales["${locale}"].name must be string`;
      entry.name = name;
    }
    if (strings.description !== undefined) {
      const desc = asString(strings.description);
      if (!desc) return `i18n.locales["${locale}"].description must be string`;
      if (desc.length > 200) {
        return `i18n.locales["${locale}"].description must be ≤ 200 chars`;
      }
      entry.description = desc;
    }
    if (strings.tags !== undefined) {
      const arr = asStringArray(strings.tags);
      if (!arr) return `i18n.locales["${locale}"].tags must be string[]`;
      if (arr.length > 8) return `i18n.locales["${locale}"].tags must be ≤ 8`;
      entry.tags = arr;
    }
    out.locales[locale] = entry;
  }
  return out;
}

/**
 * `dependencies` — CDN script / stylesheet the host injects into the iframe.
 *
 * Two invariants, both enforced here rather than at injection time:
 *  1. https-only. A `http://` or protocol-relative URL would load over a
 *     channel the app can already observe, so the "dependency" becomes a
 *     plain injection vector into the app's own origin.
 *  2. The host must already be in `permissions.net.allow`. This is the one
 *     that actually matters: the CSP widening is derived from this list, so
 *     skipping the check would let a MiniApp declare `cdn.evil.com` and have
 *     the host quietly open script-src for it — a permission escalation
 *     disguised as a build-time convenience.
 */
function parseDependencies(raw: unknown, perms: MiniAppPermissions): MiniAppDependency[] | string {
  if (!Array.isArray(raw)) return 'dependencies must be an array';
  if (raw.length > 10) return 'dependencies must be ≤ 10';

  const netAllow = perms.net?.allow ?? [];
  const out: MiniAppDependency[] = [];

  for (const entry of raw) {
    const rec = asRecord(entry);
    if (!rec) return 'each dependency must be an object';

    const url = asString(rec.url);
    if (!url) return 'dependency.url is required (string)';

    const type = asString(rec.type);
    if (type !== 'script' && type !== 'style') {
      return "dependency.type must be 'script' | 'style'";
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `dependency.url is not a valid absolute URL: ${url}`;
    }
    if (parsed.protocol !== 'https:') {
      return `dependency.url must be https: ${url}`;
    }
    if (!hostAllowed(url, netAllow)) {
      return (
        `dependency host '${parsed.host}' must be declared in permissions.net.allow` +
        (netAllow.length === 0 ? ' (net.allow is empty)' : '')
      );
    }

    out.push({ url, type });
  }

  return out;
}

/**
 * 契约槽位名（`bg-primary`），由 `contract.json` 派生。
 *
 * 刻意从 JSON 读而不是手写一份 `Set`：手写的那份会和契约漂移，而漂移的后果是
 * "作者声明了一个宿主不认识的槽位" —— 宿主照单全收、静默忽略，然后作者以为自己
 * 换掉了底色，实际什么都没发生。
 */
const CONTRACT_SLOTS: ReadonlySet<string> = new Set(
  appearanceContract.variables.map((v: { name: string }) => v.name.replace(/^--hamuna-/, '')),
);

/**
 * 字面 CSS 颜色。
 *
 * 刻意**不接受** `var(...)`。`palette` 的意义是"这一版的底色由我定"，而
 * `var(--hamuna-bg-primary)` 恰恰是把决定权交回宿主 —— 收了它，bespoke 就只是
 * 多一层间接，谁也说不清最终颜色从哪来。
 */
const LITERAL_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([^()]*\)|[a-z]+)$/;

function parsePalette(
  raw: unknown,
  field: string,
): { palette: Record<string, string> } | string {
  const rec = asRecord(raw);
  if (!rec) return `${field} must be an object`;

  const palette: Record<string, string> = {};
  for (const [slot, value] of Object.entries(rec)) {
    if (!CONTRACT_SLOTS.has(slot)) {
      return (
        `${field}."${slot}" is not a MiniApp appearance token. ` +
        'Keys are contract variable names without the --hamuna- prefix ' +
        `(see src/shared/miniapp-appearance/contract.json): ${[...CONTRACT_SLOTS].join(', ')}`
      );
    }
    const color = asString(value);
    if (!color) return `${field}."${slot}" must be a string`;
    if (!LITERAL_COLOR_RE.test(color.trim())) {
      return (
        `${field}."${slot}" must be a literal CSS color (hex / rgb() / hsl() / keyword), ` +
        `got ${JSON.stringify(color)}. Referencing var(--hamuna-*) here would hand the ` +
        'color decision back to the host, which is the opposite of what bespoke means'
      );
    }
    palette[slot] = color.trim();
  }
  return { palette };
}

/**
 * `meta.json::appearance`。缺省 = 跟随宿主，`mode: 'bespoke'` 时用作者声明的
 * 调色板覆盖契约槽位。
 */
function parseAppearance(raw: unknown): MiniAppAppearance | string {
  const rec = asRecord(raw);
  if (!rec) return 'appearance must be an object';

  const mode = asString(rec.mode);
  if (mode !== 'host' && mode !== 'bespoke') {
    return "appearance.mode must be 'host' | 'bespoke'";
  }

  let palette: Record<string, string> | undefined;
  if (rec.palette !== undefined) {
    const parsed = parsePalette(rec.palette, 'appearance.palette');
    if (typeof parsed === 'string') return parsed;
    palette = parsed.palette;
  }

  let paletteDark: Record<string, string> | undefined;
  if (rec.palette_dark !== undefined) {
    const parsed = parsePalette(rec.palette_dark, 'appearance.palette_dark');
    if (typeof parsed === 'string') return parsed;
    paletteDark = parsed.palette;
  }

  if (mode === 'bespoke' && !palette) {
    return (
      "appearance.mode 'bespoke' requires a palette. A bespoke theme with no palette " +
      'is just an undeclared custom theme: the host would inject its own colors and the ' +
      'author would have no way to tell that nothing happened'
    );
  }
  if (mode === 'host' && (palette || paletteDark)) {
    return "appearance.palette requires mode 'bespoke' (or omit both and inherit the host theme)";
  }

  return {
    mode,
    ...(palette ? { palette } : {}),
    ...(paletteDark ? { palette_dark: paletteDark } : {}),
  };
}

export function parseMiniAppMetadata(raw: unknown): MiniAppResponse<MiniAppMetadata> {
  const r = asRecord(raw);
  if (!r) return err('E_SCHEMA_INVALID', 'meta.json must be an object');

  const id = asString(r.id);
  if (!id) return err('E_SCHEMA_INVALID', 'id is required (string)');
  if (!/^[a-z0-9-]+$/.test(id)) {
    return err('E_SCHEMA_INVALID', 'id must be kebab-case (lowercase letters, digits, dashes)');
  }

  const name = asString(r.name);
  if (!name) return err('E_SCHEMA_INVALID', 'name is required (string)');

  const description = asString(r.description);
  if (!description) return err('E_SCHEMA_INVALID', 'description is required (string)');
  if (description.length > 200) {
    return err('E_SCHEMA_INVALID', 'description must be ≤ 200 chars');
  }

  const icon = asString(r.icon);
  if (!icon) return err('E_SCHEMA_INVALID', 'icon is required (string)');

  const category = asString(r.category) as MiniAppMetadata['category'] | undefined;
  if (!category || !KNOWN_CATEGORIES.has(category)) {
    return err('E_SCHEMA_INVALID', `category must be one of ${[...KNOWN_CATEGORIES].join('|')}`);
  }

  const version = asNumber(r.version);
  if (version === undefined || !Number.isInteger(version)) {
    return err('E_SCHEMA_INVALID', 'version is required (integer)');
  }

  const minHostVersion = asString(r.min_host_version);
  if (!minHostVersion || !SEMVER_RE.test(minHostVersion)) {
    return err('E_SCHEMA_INVALID', 'min_host_version is required (SemVer x.y.z)');
  }

  let tags: string[] | undefined;
  if (r.tags !== undefined) {
    const arr = asStringArray(r.tags);
    if (!arr) return err('E_SCHEMA_INVALID', 'tags must be string[]');
    if (arr.length > 8) return err('E_SCHEMA_INVALID', 'tags must be ≤ 8');
    tags = arr;
  }

  const permsOrErr = parsePermissions(r.permissions);
  if (typeof permsOrErr === 'string') {
    return err('E_SCHEMA_INVALID', permsOrErr);
  }

  // Phase 2 (PRD v0.4 §B.3) — MiniApp-declared skills subset. The cap is
  // hard-coded at 5 here (cross-bundle validation belongs in the renderer
  // install flow, not the schema; see skill-reload.ts for the helper).
  let skills: string[] | undefined;
  if (r.skills !== undefined) {
    const arr = asStringArray(r.skills);
    if (!arr) return err('E_SCHEMA_INVALID', 'skills must be string[]');
    if (arr.length > 5) {
      return err('E_SCHEMA_INVALID', 'skills must be ≤ 5');
    }
    skills = arr;
  }

  // Phase 3 (PRD v0.4 §B.4) — MiniApp execution kind.
  let kind: MiniAppMetadata['kind'];
  if (r.kind !== undefined) {
    const k = asString(r.kind);
    if (k !== 'iframe' && k !== 'worker') {
      return err('E_SCHEMA_INVALID', "kind must be 'iframe' | 'worker'");
    }
    kind = k;
  }
  let workerKind: string | undefined;
  if (r.worker_kind !== undefined) {
    const wk = asString(r.worker_kind);
    if (!wk) return err('E_SCHEMA_INVALID', 'worker_kind must be string');
    if (kind !== 'worker') {
      return err('E_SCHEMA_INVALID', "worker_kind requires kind === 'worker'");
    }
    if (!/^[a-z0-9-]+$/.test(wk)) {
      return err('E_SCHEMA_INVALID', 'worker_kind must be kebab-case (lowercase letters, digits, dashes)');
    }
    workerKind = wk;
  }

  let dependencies: MiniAppDependency[] | undefined;
  if (r.dependencies !== undefined) {
    const parsedDeps = parseDependencies(r.dependencies, permsOrErr);
    if (typeof parsedDeps === 'string') {
      return err('E_SCHEMA_INVALID', parsedDeps);
    }
    dependencies = parsedDeps;
  }

  // meta.json 是作者完全可控的输入，storage 是信任边界：形状不对必须当场拒，
  // 不能"解析不出来就当没声明"。作者会照着 SKILL.md 的例子写，形状写错却静默
  // 变回 undefined，表现和"没写 storage"完全一样。
  let storage: MiniAppMetadata["storage"] | undefined;
  if (r.storage !== undefined) {
    const rec = asRecord(r.storage);
    if (!rec) return err('E_SCHEMA_INVALID', 'storage must be an object');
    let defaults: Record<string, unknown> | undefined;
    if (rec.defaults !== undefined) {
      const d = asRecord(rec.defaults);
      if (!d) return err('E_SCHEMA_INVALID', 'storage.defaults must be an object');
      defaults = d;
    }
    storage = { ...(defaults ? { defaults } : {}) };
  }

  let i18n: MiniAppI18n | undefined;
  if (r.i18n !== undefined) {
    const parsedI18n = parseI18n(r.i18n);
    if (typeof parsedI18n === 'string') {
      return err('E_SCHEMA_INVALID', parsedI18n);
    }
    i18n = parsedI18n;
  }

  let appearance: MiniAppAppearance | undefined;
  if (r.appearance !== undefined) {
    const parsed = parseAppearance(r.appearance);
    if (typeof parsed === 'string') return err('E_SCHEMA_INVALID', parsed);
    appearance = parsed;
  }

  const out: MiniAppMetadata = {
    id,
    name,
    description,
    icon,
    category,
    version,
    min_host_version: minHostVersion,
    permissions: permsOrErr,
    ...(tags ? { tags } : {}),
    ...(skills ? { skills } : {}),
    ...(kind ? { kind } : {}),
    ...(workerKind ? { worker_kind: workerKind } : {}),
    ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
    ...(i18n ? { i18n } : {}),
    ...(storage ? { storage } : {}),
    ...(appearance ? { appearance } : {}),
  };

  const createdAt = asNumber(r.created_at);
  if (createdAt !== undefined) out.created_at = createdAt;
  const updatedAt = asNumber(r.updated_at);
  if (updatedAt !== undefined) out.updated_at = updatedAt;
  if (r.ai_context !== undefined) {
    const ac = asString(r.ai_context);
    if (ac === undefined) return err('E_SCHEMA_INVALID', 'ai_context must be string|null');
    out.ai_context = ac;
  }

  return ok(out);
}