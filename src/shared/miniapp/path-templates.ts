/**
 * MiniApp 路径模板解析（PRD v0.4 §B.1 #2 + PRD v0.3 §2.1.1）。
 *
 * 纯函数：把 `permissions.fs.read/write` 数组里的 `{appdata}` / `{workspace}` /
 * `{user-selected}` 模板解析成实际路径前缀。**不**触碰 fs —— 实跑 fs 沙箱
 * 校验走 server 侧 `src/server/utils/path-safety.ts::validateFilePath`
 * （CLAUDE.md §Pit-of-Success "path-safety"）。
 *
 * 与 PRD v0.3 §11.3 对齐：canonicalize + 不跟随 symlink + allow-list 三件套。
 */

export const APPDATA_TEMPLATE = '{appdata}';
export const WORKSPACE_TEMPLATE = '{workspace}';
export const USER_SELECTED_TEMPLATE = '{user-selected}';

export type PathTemplate =
  | typeof APPDATA_TEMPLATE
  | typeof WORKSPACE_TEMPLATE
  | typeof USER_SELECTED_TEMPLATE;

export const KNOWN_TEMPLATES: readonly PathTemplate[] = [
  APPDATA_TEMPLATE,
  WORKSPACE_TEMPLATE,
  USER_SELECTED_TEMPLATE,
] as const;

export interface ResolveContext {
  appdataDir: string;
  workspaceDir?: string | null;
  userSelectedDirs?: string[];
}

export interface ResolvedPathEntry {
  raw: string;
  resolved: string;
  template: PathTemplate | null;
}

/**
 * 把一个模板路径解析成绝对路径前缀。**不**做 fs 校验，只做字符串替换。
 * 模板前缀必须以 `{/}` 开头（CLAUDE.md §Pit-of-Success "硬路径禁止"），
 * 其他字面量当字面量处理（无 wildcard）。
 */
export function resolvePathTemplate(raw: string, ctx: ResolveContext): ResolvedPathEntry {
  if (raw.startsWith(APPDATA_TEMPLATE)) {
    return {
      raw,
      resolved: ctx.appdataDir + raw.slice(APPDATA_TEMPLATE.length),
      template: APPDATA_TEMPLATE,
    };
  }
  if (raw.startsWith(WORKSPACE_TEMPLATE)) {
    if (!ctx.workspaceDir) {
      throw new Error(`Path template ${WORKSPACE_TEMPLATE} requires workspaceDir`);
    }
    return {
      raw,
      resolved: ctx.workspaceDir + raw.slice(WORKSPACE_TEMPLATE.length),
      template: WORKSPACE_TEMPLATE,
    };
  }
  if (raw.startsWith(USER_SELECTED_TEMPLATE)) {
    if (!ctx.userSelectedDirs?.length) {
      throw new Error(`Path template ${USER_SELECTED_TEMPLATE} requires at least one user-selected dir`);
    }
    // 用户可选多目录 —— 解析成第一个（Phase 0 简化，Phase 2 加多选 UI）
    const base = ctx.userSelectedDirs[0];
    return {
      raw,
      resolved: base + raw.slice(USER_SELECTED_TEMPLATE.length),
      template: USER_SELECTED_TEMPLATE,
    };
  }
  // 无模板前缀：字面量路径（不允许，但解析层只警告不抛 —— 让上层 schema 拦截）
  return { raw, resolved: raw, template: null };
}

export function resolvePathList(
  raws: readonly string[] | undefined,
  ctx: ResolveContext,
): ResolvedPathEntry[] {
  if (!raws) return [];
  return raws.map((r) => resolvePathTemplate(r, ctx));
}

/**
 * 校验 raw 路径是否以已知模板开头（schema 层硬门）。
 * 返回 null = 通过；返回 string = 错误信息。
 */
export function validatePathTemplatePrefix(raw: string): string | null {
  if (KNOWN_TEMPLATES.some((t) => raw.startsWith(t))) return null;
  return `Path '${raw}' must start with one of ${KNOWN_TEMPLATES.join(', ')}`;
}