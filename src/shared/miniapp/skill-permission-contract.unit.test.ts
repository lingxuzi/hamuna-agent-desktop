import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkAppPermission } from './app-permissions';

/**
 * SKILL.md 是作者唯一的契约。历史上它和权限闸门脱过节，而且脱节的方向是
 * **文档说不用声明、代码直接拒**：clipboard 曾和 dialog 一起被文档归进
 * 「无需权限声明」，而 `checkClipboard` 早就要求显式 opt-in 了。于是每个照着
 * 文档写的 MiniApp 都在运行期拿到 `PERMISSION_DENIED`，作者无从查起。
 *
 * 所以这里从**代码**倒推期望：空 `permissions` 下被拒的 group，文档就必须写出
 * 它的 opt-in 声明。以后再新增一个需要授权的 group，忘了写文档，这��测试会红。
 */
const SKILL = readFileSync(join(process.cwd(), 'bundled-skills', 'miniapp-creator', 'SKILL.md'), 'utf8');

/**
 * 期望从**代码**倒推：空 `permissions` 下被拒的 group，Schema 章节就必须列出它。
 *
 * 只查 Schema 章节、不全文搜，是因为散文里也会出现同一串声明——clipboard 和 node
 * 的正文各写了一遍，全文 `toContain` 会被正文满足，于是把 Schema 里那行删掉
 * 测试还是绿的，断言就成了摆设。
 */
const SCHEMA_SECTION = (() => {
  const start = SKILL.indexOf('\n## Schema');
  if (start < 0) throw new Error('SKILL.md no longer has a "## Schema" section');
  const rest = SKILL.slice(start + 1);
  const next = rest.slice(1).search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next + 1);
})();

/** 每个探针都是该 group 下一个必然被拒的调用，空 permissions 即可。 */
const GATED: ReadonlyArray<{ probe: string; schemaKey: string }> = [
  { probe: 'clipboard.readText', schemaKey: '"clipboard":' },
  { probe: 'ai.complete', schemaKey: '"ai":' },
  { probe: 'agent.run', schemaKey: '"agent":' },
  // worker 的能力名是 app.call，但开关挂在 permissions.node 上——两处名字不一样。
  { probe: 'call.anything', schemaKey: '"node":' },
];

describe('SKILL.md 的权限说明必须和 checkAppPermission 一致', () => {
  it.each(GATED)('$probe 空权限下确实被拒（前提，变了就说明闸门改了）', ({ probe }) => {
    expect(checkAppPermission(probe as never, {}, {}).allowed).toBe(false);
  });

  it.each(GATED)('Schema 章节必须列出 $schemaKey（作者照抄的地方）', ({ schemaKey }) => {
    expect(SCHEMA_SECTION).toContain(schemaKey);
  });

  it('clipboard 不得再被归进「无需权限声明」——它是宿主的用户状态，不是 dialog 那档', () => {
    const freeClaims = SKILL.split('\n').filter((line) => line.includes('无需权限声明'));
    expect(freeClaims.length).toBeGreaterThan(0);
    for (const line of freeClaims) {
      expect(line).not.toContain('clipboard');
    }
  });

  it('dialog 仍然免权限——文档对它的说法必须是真的', () => {
    expect(checkAppPermission('dialog.open' as never, {}, {}).allowed).toBe(true);
  });
});
