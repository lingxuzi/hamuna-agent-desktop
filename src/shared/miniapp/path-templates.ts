/**
 * MiniApp 路径模板的**词法**约束（PRD v0.4 §B.1 #2）。
 *
 * 故意只有校验、没有解析：`{appdata}` / `{workspace}` 的真实展开发生在 sidecar，
 * 见 `src/server/miniapp-app-dispatch.ts::expandAuthorPath`。两边各写一套解析器
 * 只会多一处必然漂移的地方，而且 shared 这一份没有 appdata / workspace 根可拿
 * —— 它只能校验字符串形状，无从知道展开结果。
 *
 * ## `{user-selected}` 不在可用集合里
 *
 * 它依赖 dialog 记录的用户选择目录，sidecar 目前既不记录也没有作者可见的选择
 * 契约，所以 `expandAuthorPath` 对它返回 `null`（fail-closed）。把它放进
 * `KNOWN_TEMPLATES` 会让 schema 放行一个运行时必然拒绝的声明 —— 作者照文档
 * 写 `{user-selected}`，然后每个 `app.fs.*` 都吃 PERMISSION_DENIED，且错误信息
 * 指向路径而不是指向"这个 token 不支持"。
 *
 * 因此：**支持一个模板 = 放它进 KNOWN_TEMPLATES**，接线时同一个 commit 里补上
 * 展开实现与这里的成员，否则宁可留在外面让人一眼看出未实现。
 */

export const APPDATA_TEMPLATE = '{appdata}';
export const WORKSPACE_TEMPLATE = '{workspace}';

export type PathTemplate = typeof APPDATA_TEMPLATE | typeof WORKSPACE_TEMPLATE;

export const KNOWN_TEMPLATES: readonly PathTemplate[] = [
  APPDATA_TEMPLATE,
  WORKSPACE_TEMPLATE,
] as const;

/**
 * 校验 raw 路径是否以已知模板开头（schema 层硬门）。
 * 返回 null = 通过；返回 string = 错误信息。
 */
export function validatePathTemplatePrefix(raw: string): string | null {
  if (KNOWN_TEMPLATES.some((t) => raw.startsWith(t))) return null;
  return `Path '${raw}' must start with one of ${KNOWN_TEMPLATES.join(', ')}`;
}