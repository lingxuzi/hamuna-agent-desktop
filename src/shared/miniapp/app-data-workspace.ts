/**
 * `appDataWorkspace` 归一 —— 参考文档里 `agent.ensureSession` /
 * `agent.run` 的可选参数，作用是让 MiniApp 在**自己的 appdata 底下**挑一个
 * 子目录当 Agent workspace。
 *
 * 它和"Agent workspace 强制落在 appdata 下"这条安全立场不冲突：约束的是
 * "必须在 appdata 内"，而不是"必须等于 appdata 根"。作者能挑的是 appdata 里的
 * 一个直接子目录，出不了 appdata。
 *
 * 纯字符串判定，**不碰文件系统** —— 落在 `shared/` 是因为 renderer 与 sidecar
 * 都要读它，而 shared 不能依赖 `node:path`。真正的"解析后仍在 appdata 内"由
 * sidecar 在拼完路径后用一次文件系统级断言兜底（见 miniapp-app-dispatch）。
 *
 * 拒绝规则里最容易被忽略的是**尾随点/空格**和**Windows 保留设备名**：Win32 会
 * 静默剥掉它们，于是 `work.` 与 `work` 指向同一个目录，`CON` 是一台设备而不是
 * 一个目录。这类输入在小程序作者手里多半是拼错，产出的却是"能跑但行为诡异"
 * 的结果，比当场报错难查。
 */

/** 显式空串不是"用默认值"，是作者写了没意义的东西 —— 与 `undefined` 区分开。 */
export type AppDataWorkspaceResult =
  | { ok: true; segment: string }
  | { ok: false; reason: string };

/** 子目录名长度上限。一个 workspace 名超过这个长度基本是误传了一整条路径。 */
const MAX_SEGMENT_LEN = 64;

/** Win32 路径里必须自己挡掉的字符（外加控制字符由下面的码点循环兜）。 */
const FORBIDDEN_CHARS = /[/\\:*?"<>|]/;

const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * 归一作者给的 workspace 名。`undefined` / `null` 视为"用 appdata 根"，返回空
 * `segment`；给了值就必须合法，否则带 `reason` 失败。
 */
export function normalizeAppDataWorkspace(raw: unknown): AppDataWorkspaceResult {
  if (raw === undefined || raw === null) return { ok: true, segment: '' };

  if (typeof raw !== 'string') {
    return { ok: false, reason: 'appDataWorkspace must be a string' };
  }

  const segment = raw.trim();
  if (!segment) {
    return { ok: false, reason: 'appDataWorkspace must not be empty' };
  }
  if (segment.length > MAX_SEGMENT_LEN) {
    return {
      ok: false,
      reason: `appDataWorkspace must be at most ${MAX_SEGMENT_LEN} characters, got ${segment.length}`,
    };
  }
  if (FORBIDDEN_CHARS.test(segment)) {
    return {
      ok: false,
      reason: `appDataWorkspace must be a single directory name; '${segment}' contains a path separator or reserved character`,
    };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(segment)) {
    return { ok: false, reason: 'appDataWorkspace must not contain control characters' };
  }
  if (segment === '.' || segment === '..') {
    return { ok: false, reason: "appDataWorkspace must not be '.' or '..'" };
  }
  if (segment.startsWith('.') || segment.endsWith('.')) {
    return {
      ok: false,
      reason: `appDataWorkspace must not start or end with '.'; Win32 strips it and would alias '${segment}' onto a different directory`,
    };
  }
  // 尾随空格**不在这里**拒：上面已经 `raw.trim()`，那条分支永远不成立。
  // 归一掉反而是更安全的契约 —— trim 之后两平台拿到的是同一个名字，没有 Win32
  // 别名可言；反过来"在 Linux 上建一个 Windows 根本没法寻址的目录"才是真坑。
  // Rust 那边（`resolve_miniapp_agent_workspace`）同样只 trim，两边一致。
  // 曾在这里留过一条 `endsWith(' ')` 的拒绝分支：它跑在 trim 之后，恒为 false，
  // 于是两边的规则表看起来不一致（一边像是拒绝、一边其实是归一）。已删。

  // 保留设备名按"第一个点前的那段"判定：`CON.txt` 同样打向 CON 设备。
  const stem = (segment.split('.')[0] ?? '').toLowerCase();
  if (WINDOWS_RESERVED.has(stem)) {
    return {
      ok: false,
      reason: `'${stem}' is a reserved Windows device name and cannot be a directory`,
    };
  }

  return { ok: true, segment };
}
