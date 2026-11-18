// 账号画像（`.claude/rules/03-USER.md`）的解析。
//
// **写回去的活交给 Agent**：向导不再替人填这张 22 字段的表 —— Sino 逐条问，
// 答完自己写进那个文件。前端只留「读」：冷启动判据要知道画像填过没有。
//
// **这个文件归用户**：模板 manifest 把它列进 `userOwned`，模板收敛永远不写它
// （`template_sync.rs` 遇到 userOwned 直接 `continue`）。谁写都只能「按标签行
// 替换值」，绝不重写整个文件 —— 用户手改的段落（`## Context`、斜体提示、
// 任何别的行）必须原样留着。
//
// 格式契约（来自 `agent-templates/sino/.claude/rules/03-USER.md`）：
// 六维 = 六个 `### N. <key> — <标题>` 小节，每节下面是若干 `- **标签：**` 行，
// 值写在冒号后面（模板里是空的）。这里按这个形状解析；模板改了形状，这里解析
// 不出那一节 → 判据读到空，而不是把文件搞坏。

/** 账号画像在工作区里的位置。模板 manifest 把它列进 `userOwned`。 */
export const USER_PROFILE_PATH = '.claude/rules/03-USER.md';

export interface UserProfileField {
  /** 标签原文（文件里的字面量）。写回时按它定位，不是按界面上的文案。 */
  tag: string;
  /** 当前值。空串 = 还没填。 */
  value: string;
}

export interface UserProfileSection {
  /** `### 1. identity — …` 里的 `identity`。空串 = 不在六维小节里的散行。 */
  key: string;
  /**
   * 小节标题（`### 1. identity — 这个号是谁` 里的「这个号是谁」）。
   *
   * **界面直接用它当标题，不另配一套翻译**：这个文件本身就是中文写的，用户
   * 打开 `03-USER.md` 看到的就是这些字。界面上写「Account」，文件里写着
   * 「这个号是谁」，两套话对不上，反而让人怀疑写错了地方。
   */
  title: string;
  fields: UserProfileField[];
}

/**
 * `- **标签：** 值`
 *
 * 标签里的全角冒号在 `**` **内侧** —— 模板写的是 `- **账号名：**`，冒号跟着
 * 标签一起被加粗。正则按这个形状写；冒号跑到 `**` 外侧就匹配不上（那一节的
 * 字段会被跳过，而不是被写坏）。
 */
const TAG_LINE = /^(\s*-\s*\*\*(.+?)：\*\*)(.*)$/;

/** `### 1. identity — 这个号是谁` → key `identity`，标题 `这个号是谁`。 */
const SECTION_HEAD = /^###\s+\d+\.\s+([A-Za-z0-9_-]+)\s*(?:[—–-]\s*)?(.*)$/;

/**
 * 拆行 + 记住行尾符。
 *
 * 回写用户自己的文件不能顺手把 CRLF 改成 LF —— 那是一次没人要求、也没人看得
 * 见的改动，diff 里全是它，真正要改的那一行反而被淹了。
 */
function splitLines(content: string): { lines: string[]; eol: string } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return { lines: content.split(eol), eol };
}

/**
 * 解析出六维小节与每个小节里的标签。
 *
 * 标签行落在任何 `###` 小节之外时归到一个 key 为空串的隐式小节 —— 不丢，
 * 也不假装它属于某一维。
 */
export function parseUserProfile(content: string): UserProfileSection[] {
  const sections: UserProfileSection[] = [];
  let current: UserProfileSection | null = null;

  for (const line of splitLines(content).lines) {
    const head = SECTION_HEAD.exec(line);
    if (head) {
      current = { key: head[1], title: head[2].trim(), fields: [] };
      sections.push(current);
      continue;
    }
    const tag = TAG_LINE.exec(line);
    if (!tag) continue;
    if (!current) {
      current = { key: '', title: '', fields: [] };
      sections.push(current);
    }
    current.fields.push({ tag: tag[2], value: tag[3].trim() });
  }

  return sections;
}

/**
 * 画像里有没有填过东西。
 *
 * 模板里六维 22 个标签全是空的 —— 全空 = 画像还是模板默认值 = 这个人还没被
 * 描述过。冷启动判据用它区分「没人填过」和「填了一点」。
 */
export function isProfileFilled(content: string): boolean {
  return parseUserProfile(content).some((section) =>
    section.fields.some((field) => field.value.trim().length > 0),
  );
}
