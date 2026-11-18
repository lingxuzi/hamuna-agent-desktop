import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseUserProfile } from './userProfile';

// 模板里那份真实的画像文件。
//
// 读真文件而不是抄一份 fixture：冷启动判据读的就是它。模板改了形状（全角冒号
// 跑到 `**` 外侧、标签改了字、小节标题改了写法），而这里还在绿 = 护栏漏了。
const TEMPLATE = readFileSync(
  join(process.cwd(), 'agent-templates/sino/.claude/rules/03-USER.md'),
  'utf8',
);

describe('账号画像的解析', () => {
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

  it('模板里不预填 —— 预填了冷启动判据会永远判成「已经填过」', () => {
    const fields = parseUserProfile(TEMPLATE).flatMap((section) => section.fields);

    expect(fields).toHaveLength(22);
    expect(fields.every((field) => field.value === '')).toBe(true);
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
