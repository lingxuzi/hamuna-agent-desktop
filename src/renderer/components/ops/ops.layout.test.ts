/**
 * 运营面板的排版护栏：**会吃掉剩余空间的轨道必须允许缩到内容 min-content 以下**。
 *
 * 2026-11 实战：面板窄到 ~880px 时，方向域的两张卡（「账号方向」「定稿进度」）
 * 横向溢出面板 —— 卡片里的标题是**不换行**的一行字（nowrap + 省略号），它的
 * min-content 就是整句宽度。网格轨道按 auto 最小值撑开，宽列把整张网格顶出
 * 面板，窄列被挤到标题每个字一行，底部还多出一条横向滚动条。
 *
 * jsdom 不做布局，量不出溢出；这里锁的是**成因**而不是结果：凡是内容里可能
 * 出现不换行文字的轨道，都必须写成 `minmax(0, …)`。改回裸 `1fr` = 溢出复现。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 按 cwd 找文件（与 Markdown.typography.test.tsx 同理：dom 池里 import.meta.url
// 会被改写成 http URL）。注释先剥掉：注释里的选择器不该被当成规则。
const css = readFileSync(
  join(process.cwd(), 'src/renderer/components/ops/ops.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** 取某条规则块里的 grid-template-columns 声明值。 */
function gridColumns(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 选择器独占一行（文件就是这么排的），`m` 让 ^ 锚在行首 —— 复合选择器
  // （`.ops-list .t`）不会被误当成 `.ops-list`。
  const rule = new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!rule) throw new Error(`ops.css 里没有 ${selector} 这条规则`);
  const decl = /grid-template-columns:\s*([^;]+);/.exec(rule[1]);
  if (!decl) throw new Error(`${selector} 没有声明 grid-template-columns`);
  return decl[1].trim();
}

/** 按顶层空格拆轨道（`minmax(0, 1fr)` 内部的空格不算分隔符）。 */
function splitTracks(value: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current) tracks.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tracks.push(current);
  return tracks;
}

/**
 * 这些轨道里装着不换行的文字（卡标题、台账行标题、分布条名字）：
 * 轨道下限必须是 0，否则卡片的 min-content 会把整张网格顶出面板。
 */
const SHRINKABLE_TRACKS: { selector: string; why: string }[] = [
  // 网格的唯一持有者是 .ops-body：.ops-main / .ops-rail / .ops-grid 都是
  // display:contents，把三轨摊平到同一张位置表上。护栏盯着旧的 .ops-grid
  // 就等于盯着一块不再定义列的元素。
  { selector: '.ops-body', why: '三轨各装一张卡，宽度由另一列的卡片内容决定' },
  { selector: '.ops-list', why: '台账行标题不换行，整句就是它的 min-content' },
  {
    selector: '.ops-list-head',
    why: '列头与台账行同名列对齐，行会缩，头也得能缩',
  },
  {
    selector: '.ops-bars li',
    why: '分布条名字自带省略号，窄栏下该省略而不是撑宽',
  },
  { selector: '.ops-dir-body', why: '方向正文缩进 46px，剩余宽度还要留给值列' },
];

describe('ops.css — 轨道可缩', () => {
  for (const { selector, why } of SHRINKABLE_TRACKS) {
    it(`${selector} 的 fr 轨道下限是 0（${why}）`, () => {
      const tracks = splitTracks(gridColumns(selector)).filter((t) =>
        t.includes('fr'),
      );
      expect(tracks.length).toBeGreaterThan(0);
      for (const track of tracks) {
        expect(track.startsWith('minmax(0,')).toBe(true);
      }
    });
  }
});
