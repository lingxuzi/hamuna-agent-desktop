/**
 * MiniApp `meta.json` schema validator（PRD v0.4 §B.1 #1 + PRD v0.3 §2.1.1）。
 *
 * Phase 0 子集：fs/shell/net/ai 4 类权限，**不**含 node/agent/chat 三块。
 * 手动 validator 模式（与 `src/shared/mcpConfig.ts` 同款 pattern；shared/
 * 禁顶层 import zod —— 见 CLAUDE.md §Pit-of-Success builtin MCP 懒加载）。
 */

import { err, ok, type MiniAppResponse } from './errors';
import { validatePathTemplatePrefix } from './path-templates';
import type { MiniAppI18n, MiniAppMetadata, MiniAppPermissions } from './types';

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

  let i18n: MiniAppI18n | undefined;
  if (r.i18n !== undefined) {
    const parsedI18n = parseI18n(r.i18n);
    if (typeof parsedI18n === 'string') {
      return err('E_SCHEMA_INVALID', parsedI18n);
    }
    i18n = parsedI18n;
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
    ...(i18n ? { i18n } : {}),
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