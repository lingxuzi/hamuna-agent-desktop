/**
 * One validator for every MiniApp appId that reaches the filesystem.
 *
 * Six routes take an appId that Rust turns into a path
 * (`~/.hamuna/miniapps/<appId>/`), and each one used to inline its own copy of
 * the regex. They had already drifted: create/source/install/spawn also
 * rejected a leading or trailing dash, while diff/uninstall accepted them — so
 * `-foo` was a legal id to uninstall but never a legal id to create.
 *
 * Tightening diff/uninstall is safe: no id reachable through the strict routes
 * can have an edge dash, so nothing installable becomes uninstallable.
 */
export function isKebabAppId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9-]{1,64}$/.test(value) &&
    !value.startsWith('-') &&
    !value.endsWith('-')
  );
}

export const APP_ID_ERROR = 'appId must be kebab-case ASCII (a-z, 0-9, -), 1-64 chars';
