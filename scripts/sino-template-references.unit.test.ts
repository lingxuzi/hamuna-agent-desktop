import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 方法论是从**别的仓库**搬进来的，出处必须留在文件里。
//
// sino 的 references 正文大多来自 Easel（另一个仓库）。搬的时候漏掉出处行，
// 半年后就没法知道这段判据该跟谁同步 —— 上游改了、这边没改，两边悄悄分叉，
// 而且分叉发生在「看起来还是对的」内容上，比硬报错更难发现。
//
// 这条测试盯的就是那行出处。
//
// 只能盯「有出处行 + 出处指向 Easel」：**「源文件还在不在」这一半在这儿断不了** ——
// Easel 不在本仓库里，本地 CI 看不见它。源文件的存在性靠人同步时确认。

const SKILLS_ROOT = join(process.cwd(), 'agent-templates/sino/.claude/skills');

/** 出处行的形状：`> **方法论来源**：…`。 */
const PROVENANCE_LINE = /^> \*\*方法论来源\*\*：/;

function referenceFiles(): string[] {
  const files: string[] = [];
  for (const skill of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    const refsDir = join(SKILLS_ROOT, skill.name, 'references');
    let entries: string[];
    try {
      entries = readdirSync(refsDir);
    } catch {
      continue; // 这个 skill 没有 references 目录
    }
    for (const entry of entries) {
      if (entry.endsWith('.md')) files.push(join(refsDir, entry));
    }
  }
  return files.sort();
}

function provenanceLine(file: string): string | null {
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((candidate) => PROVENANCE_LINE.test(candidate.trim()));
  return line ? line.trim() : null;
}

describe('sino 方法论文件的出处', () => {
  it('每个 references/*.md 都写了方法论来源', () => {
    const files = referenceFiles();
    // 非空断言：目录路径写错时下面的循环会空跑，测试会假绿。
    expect(files.length).toBeGreaterThan(0);

    const missing = files.filter((file) => provenanceLine(file) === null);
    expect(missing).toEqual([]);
  });

  it('出处指向 Easel —— 搬的是哪本经，得写在脸上', () => {
    for (const file of referenceFiles()) {
      const line = provenanceLine(file);
      expect(line, file).not.toBeNull();
      expect(line, file).toContain('Easel');
    }
  });

  it('搬进来的方法论文件都在这个网里', () => {
    // 钉住具体文件：glob 写错（比如 skill 目录改名）时，上面两条会一起空跑。
    const files = referenceFiles();
    for (const expected of [
      'ops-benchmark-analysis/references/viral-patterns.md',
      'ops-topic/references/hot-riding.md',
      'ops-topic/references/hotlist-sources.md',
    ]) {
      expect(files.some((file) => file.endsWith(expected)), expected).toBe(true);
    }
  });

  it('hotness 的口径是播放量 —— 热榜热度值不是', () => {
    // 蹭热点时最容易犯的错：把热榜上的 hot_value（平台算法分，八位数）填进 --hotness。
    // 台账里 hotness = 参考内容的播放量，填错就是往复盘口径里灌假数，且没人看得出来。
    // 口径写在两处：常驻的 05-OPS.md 和用它的 ops-topic/SKILL.md，两处都要在。
    const rules = readFileSync(join(process.cwd(), 'agent-templates/sino/.claude/rules/05-OPS.md'), 'utf8');
    expect(rules).toContain('播放量');
    expect(rules).toMatch(/热榜.{0,12}热度值.{0,20}不是播放量/);

    const skillMd = readFileSync(
      join(SKILLS_ROOT, 'ops-topic/SKILL.md'),
      'utf8',
    );
    expect(skillMd).toMatch(/热榜.{0,12}热度值.{0,20}不是播放量/);
  });

  it('SKILL.md 里提到的 references 都真的存在', () => {
    // skill 正文里写着「见 references/xxx.md」，那个文件要是没了，
    // Agent 读到的是一个断掉的指针 —— 它不会报错，只会照着没有的内容往下编。
    const missing: string[] = [];
    for (const skill of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const skillMd = join(SKILLS_ROOT, skill.name, 'SKILL.md');
      let body: string;
      try {
        body = readFileSync(skillMd, 'utf8');
      } catch {
        continue; // 这个 skill 没有 SKILL.md
      }
      for (const match of body.matchAll(/references\/[\w.-]+\.md/g)) {
        const target = join(SKILLS_ROOT, skill.name, match[0]);
        if (!existsSync(target)) missing.push(`${skill.name}/${match[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
