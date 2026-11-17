import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseUserProfile, patchUserProfile } from './userProfile';

// 模板里那份真实的画像文件。
//
// 读真文件而不是抄一份 fixture：向导要解析的正是它。模板改了形状（全角冒号
// 跑到 `**` 外侧、标签改了字、小节标题改了写法），而这里还在绿 = 护栏漏了。
const TEMPLATE = readFileSync(
  join(process.cwd(), 'agent-templates/sino/.claude/rules/03-USER.md'),
  'utf8',
);

describe('账号画像的解析与回写', () => {
  it('模板里的六维二十二个标签都能读回', () => {
    const sections = parseUserProfile(TEMPLATE);

    expect(sections.map((section) => section.key)).toEqual([
      'identity',
      'style',
      'audience',
      'platforms',
      'redlines',
      'cadence',
    ]);
    expect(sections.map((section) => section.fields.length)).toEqual([4, 5, 4, 3, 3, 3]);
    expect(sections.reduce((n, section) => n + section.fields.length, 0)).toBe(22);
  });

  it('模板里不预填 —— 预填了向导会把模板的例子当成用户自己填的', () => {
    const fields = parseUserProfile(TEMPLATE).flatMap((section) => section.fields);

    expect(fields).toHaveLength(22);
    expect(fields.every((field) => field.value === '')).toBe(true);
  });

  it('写回只改值，标签和其余每一行都原样', () => {
    const patched = patchUserProfile(TEMPLATE, { 账号名: '露营装备小王' });

    expect(patched).toContain('- **账号名：** 露营装备小王');

    // 逐行比：只有那一行该变。这条比「包含某段文本」强 —— 它同时钉住了
    // 「不该动的行一个都没动」和「行数没变（没往文件里插行）」。
    const before = TEMPLATE.split('\n');
    const after = patched.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before
      .map((line, i) => (line === after[i] ? null : after[i]))
      .filter((line): line is string => line !== null);
    expect(changed).toEqual(['- **账号名：** 露营装备小王']);
  });

  it('清空一个值就把那一行还原成空标签，不留尾随空格', () => {
    const filled = patchUserProfile(TEMPLATE, { 账号名: '露营装备小王' });
    const cleared = patchUserProfile(filled, { 账号名: '' });

    expect(cleared).toContain('\n- **账号名：**\n');
    expect(cleared).not.toContain('- **账号名：** ');
  });

  it('标签在文件里找不到就跳过，不往用户的文件里插行', () => {
    expect(patchUserProfile(TEMPLATE, { 不存在的标签: 'x' })).toBe(TEMPLATE);
  });

  it('用户自己写的段落不丢', () => {
    const withContext = TEMPLATE.replace(
      '## Context',
      '## Context\n\n我自己加的一段：这个号是我和老婆两个人在经营。',
    );

    const patched = patchUserProfile(withContext, { 一句话定位: '懂露营装备的' });

    expect(patched).toContain('我自己加的一段：这个号是我和老婆两个人在经营。');
    expect(patched).toContain('- **一句话定位：** 懂露营装备的');
  });

  it('CRLF 不被顺手改成 LF', () => {
    const crlf = TEMPLATE.replace(/\n/g, '\r\n');

    const patched = patchUserProfile(crlf, { 账号名: '露营装备小王' });

    expect(patched).toContain('\r\n');
    // 每个换行前面都有 \r：没有一处落单的 LF。
    expect(patched).not.toMatch(/[^\r]\n/);
  });

  it('全角冒号必须在 `**` 内侧 —— 跑到外面就不认（宁可空着，也不写坏）', () => {
    const moved = TEMPLATE.replace('- **账号名：**', '- 账号名：**');

    const tags = parseUserProfile(moved).flatMap((section) =>
      section.fields.map((field) => field.tag),
    );

    expect(tags).not.toContain('账号名');
    // 其它标签照常认得：形状变的是这一行，不是整份文件。
    expect(tags).toContain('一句话定位');
  });
});
