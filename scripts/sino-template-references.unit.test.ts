import { readdirSync, readFileSync } from 'node:fs';
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

  it('新搬进来的对标拆解方法论也在这个网里', () => {
    // 钉住具体文件：glob 写错（比如 skill 目录改名）时，上面两条会一起空跑。
    const files = referenceFiles();
    expect(files.filter((file) => file.includes('ops-benchmark-analysis'))).toHaveLength(3);
  });
});
