import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 方法论是从**别的仓库**搬进来的，出处必须留在文件里。
//
// sino 的 references 正文大多来自 Easel（另一个仓库）。搬的时候漏掉出处行，
// 半年后就没法知道这段判据该跟谁同步 —— 上游改了、这边没改，两边悄悄分叉，
// 而且分叉发生在「看起来还是对的」内容上，比硬报错更难发现。
//
// 这条测试盯的就是那行出处。
//
// 只能盯「有出处行 + 出处指向一个已登记的上游」：**「源文件还在不在」这一半在这儿断不了** ——
// Easel / Beav 都不在本仓库里，本地 CI 看不见它们。源文件的存在性靠人同步时确认。
//
// 上游目前有两个：Easel（运营方法论的大头）和 Beav（内容制作 / 蹭热点：封面与分镜导演、
// 候选批产与排序）。**新增第三个上游时，要么在这里登记，要么别搬** —— 出处行写了个
// 没人认识的名字，半年后同样不知道跟谁同步。

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

  it('出处指向已登记的上游（Easel / Beav）—— 搬的是哪本经，得写在脸上', () => {
    for (const file of referenceFiles()) {
      const line = provenanceLine(file);
      expect(line, file).not.toBeNull();
      expect(line, file).toMatch(/Easel|Beav/);
    }
  });

  it('搬进来的方法论文件都在这个网里', () => {
    // 钉住具体文件：glob 写错（比如 skill 目录改名）时，上面两条会一起空跑。
    const files = referenceFiles();
    for (const expected of [
      'ops-benchmark-analysis/references/viral-patterns.md',
      'ops-signal/references/hot-riding.md',
      'ops-signal/references/hotlist-sources.md',
      'ops-topic/references/candidate-batch.md',
      'ops-produce/references/visual-director.md',
    ]) {
      expect(files.some((file) => file.endsWith(expected)), expected).toBe(true);
    }
  });

  it('热榜 / 蹭热点的判据只有一份 —— 副本会让两边悄悄分叉', () => {
    // 这两份在 `ops-topic/references/` 下曾有内容完全相同的副本，而全模板没有一处
    // 引用它们（SKILL.md 明确指向 `ops-signal` 那份）。副本的危险不是占空间：改一处
    // 忘了另一处，Agent 读到哪份取决于 glob 顺序，两条互相矛盾的判据同时成立。
    const files = referenceFiles();
    for (const name of ['hot-riding.md', 'hotlist-sources.md']) {
      const holders = files.filter((file) => file.endsWith(`/${name}`));
      expect(holders, name).toHaveLength(1);
      expect(holders[0], name).toContain('ops-signal');
    }
  });

  it('HEARTBEAT.md 里提到的 references 都真的存在', () => {
    // 心跳清单会直接点名某个 reference（「榜源清单见 …」）。
    // 那个文件要是没了，Agent 读到的是一个断掉的指针 —— 它不会报错，只会照着没有的内容往下编。
    const heartbeatPath = join(process.cwd(), 'agent-templates/sino/HEARTBEAT.md');
    const body = readFileSync(heartbeatPath, 'utf8');
    const missing: string[] = [];
    for (const match of body.matchAll(/\.claude\/skills\/([\w.-]+)\/references\/([\w.-]+\.md)/g)) {
      const target = join(SKILLS_ROOT, match[1], 'references', match[2]);
      if (!existsSync(target)) missing.push(match[0]);
    }
    expect(missing).toEqual([]);
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

  it('无人值守取数通道写死了域名和 UA —— 别让 Agent 自己猜', () => {
    // 实战事故（2026-11-21）：定时任务里判据文件没被打包进工作区，Agent 找不到
    // 端点说明，自己编了一个 `newsnow.busiyi.com`（真名是 `.world`），白跑 8 分钟。
    // 消歧只靠这一处：域名写错、UA 要求被删，都会让下一次无人值守跑空。
    const body = readFileSync(
      join(SKILLS_ROOT, 'ops-signal/references/hotlist-sources.md'),
      'utf8',
    );
    expect(body).toContain('https://newsnow.busiyi.world/api/s?id=');
    // 不带 UA 会 403（实测）。要求写在命令旁边，不能只在散文里提。
    expect(body).toMatch(/User-Agent/);
    // 少了这条，Agent 可能把热榜热度值填进 --hotness 去复盘口径里灌假数。
    expect(body).toMatch(/不(给|返回).{0,8}热度值/);
  });

  it('没有人假装「到点会自动发」', () => {
    // 没有任何东西在轮询 `scheduledAt`：没有定时器、没有订阅、面板只在 `ops:changed`
    // 刷新。发布还必须落在一个**有浏览器面板的 Chat 会话**里（`browser_api.rs`
    // 按 session id 找面板，找不到就报错，不回退），定时任务的 session 永远认领不到。
    //
    // 这两条任何一条被写反，Agent 就会排完期说「到点自动发」然后什么都不做 ——
    // 用户以为发出去了而停止跟进，等到几天后才发现一条都没发。这是最贵的那种错。
    const root = join(process.cwd(), 'agent-templates/sino');
    const publish = readFileSync(join(SKILLS_ROOT, 'ops-publish/SKILL.md'), 'utf8');
    expect(publish).toContain('scheduledAt');
    expect(publish).toMatch(/不会自己触发/);
    // 定时任务拿不到面板这件事必须写在文件里，否则下一个改 prompt 的人会重新
    // 把发布派给 cron。
    expect(publish).toMatch(/定时任务.{0,40}(不能|拿不到)/);

    const schedule = readFileSync(join(SKILLS_ROOT, 'ops-schedule/SKILL.md'), 'utf8');
    expect(schedule).toMatch(/不会自己发/);
    // 「说成有个人会去发」= 承诺自动发布。这种句子只能出现在否定句里。
    for (const [name, body] of [
      ['HEARTBEAT.md', readFileSync(join(root, 'HEARTBEAT.md'), 'utf8')],
      ['CLAUDE.md', readFileSync(join(root, 'CLAUDE.md'), 'utf8')],
      ['ops-schedule', schedule],
    ] as const) {
      expect(body, name).not.toMatch(/(会|将|自动)在?到点自动发/);
    }
    // 心跳第 1 步必须先探面板，再决定发不发。
    const heartbeat = readFileSync(join(root, 'HEARTBEAT.md'), 'utf8');
    expect(heartbeat).toMatch(/hamuna browser list/);
    expect(heartbeat).toMatch(/没有面板.{0,20}不发布/);
  });

  it('视觉导演守住 sino 的两条硬约束 —— 不推画幅、不锁模型', () => {
    // 从 Beav 搬封面/分镜方法论时，最容易连它的实现假设一起搬：
    // (1) 按平台给默认画幅（小红书 3:4 / 抖音 9:16）。sino 的画幅**只有** formAspect 一个来源，
    //     从平台推等于猜错一次就废掉一笔钱。
    // (2) 把视频路由写死到具体模型。sino 只允许用用户已启用的工具。
    // 这两条被写反，产物会「看起来能跑」，但绕过了 form 授权和工具门。
    const body = readFileSync(
      join(SKILLS_ROOT, 'ops-produce/references/visual-director.md'),
      'utf8',
    );
    expect(body).toMatch(/画幅[^\n]*只认 `formAspect`/);
    expect(body).toMatch(/不给任何平台默认值/);
    expect(body).toMatch(/不锁模型|只用用户已启用的工具/);
  });

  it('视频仍然有一道「先看拼图再花钱」的门', () => {
    // Beav 的 video-director 把「出分镜拼图」放在付费生成之前。删掉这道门，
    // 就会变成「先花一整条视频的钱，再发现构图不对」。
    const body = readFileSync(join(SKILLS_ROOT, 'ops-produce/SKILL.md'), 'utf8');
    expect(body).toMatch(/预览硬门/);
    expect(body).toMatch(/分镜拼图/);
    expect(body).toMatch(/15 秒/);
  });

  it('候选批产的排序不把榜位冒充播放量', () => {
    // Beav 的综合分是「热度 60% + 关联度 40%」，它的热度来自有热度数值的数据源。
    // sino 的热榜只给标题和榜位，--hotness 的口径是参考内容的播放量。
    // 一旦有人把榜位换算成数填进 --hotness，复盘口径就被灌了假数，且看不出来。
    const body = readFileSync(
      join(SKILLS_ROOT, 'ops-topic/references/candidate-batch.md'),
      'utf8',
    );
    expect(body).toMatch(/不许填进 `--hotness`/);
    expect(body).toMatch(/别人作品的评论区/);
  });

  it('不存在的东西不许被写成「有」—— 定时任务与 CLI flag 两处', () => {
    // 两类幻觉，形状相同：文档对着一个**不存在的东西**说话，Agent 照着做就是空转。
    //
    // (1) `sino-hotspot-topic` 定时任务：曾有文档写「热点选题搬进了这个定时任务」，
    //     而全仓库零命中。`ops-topic` 于是「等一个永远不会来的简报」。
    // (2) `--competitor`：CLI 的 OPS_FIELDS.topic 里没有这个 flag，写了会被静默丢弃
    //     （不报错、不落库），对标信息在选题这一步丢掉。
    const root = join(process.cwd(), 'agent-templates/sino');
    const offenders: string[] = [];
    for (const skill of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const targets = [join(SKILLS_ROOT, skill.name, 'SKILL.md')];
      const refsDir = join(SKILLS_ROOT, skill.name, 'references');
      try {
        for (const entry of readdirSync(refsDir)) {
          if (entry.endsWith('.md')) targets.push(join(refsDir, entry));
        }
      } catch { /* 没有 references 目录 */ }
      for (const target of targets) {
        let body: string;
        try {
          body = readFileSync(target, 'utf8');
        } catch {
          continue;
        }
        if (/sino-hotspot-topic/.test(body)) offenders.push(`${target}: sino-hotspot-topic`);
        // 只在**可复制的命令块**里查 `--competitor`：散文里写「没有这个 flag，
        // 写了会被丢弃」是正确写法，把那种警告也判违规只会逼人删掉警告。
        for (const block of body.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g)) {
          if (/--competitor\b/.test(block[1])) offenders.push(`${target}: --competitor`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // 反向断言：模板里真有一个 cron 配置的话，这条测试会看不见 —— `PRESET_TEMPLATES`
    // 目前只带 heartbeat，没有任务定义。等哪天加了，这里要一起改。
    expect(readFileSync(join(process.cwd(), 'src/shared/config-types.ts'), 'utf8'))
      .not.toMatch(/sino-hotspot-topic/);
    void root;
  });

  it('选题的三个新硬约束真的落在 SKILL.md 上，且和 CLI 一致', () => {
    // 三处都是「别的文档指过来，但这里没有」的断指针，修法是让断言钉在落点上：
    const topic = readFileSync(join(SKILLS_ROOT, 'ops-topic/SKILL.md'), 'utf8');

    // (a) 一次最多 3 条候选 —— candidate-batch.md 和 hotlist-sources.md 都写着
    //     「硬约束在 SKILL.md」，这里必须真有。
    expect(topic).toMatch(/一次最多 3 条/);
    // (b) 自我批判：三条候选不是全推给用户。
    expect(topic).toMatch(/自我批判/);
    expect(topic).toMatch(/默认只推 1 条/);
    // (c) --angle 必须落库：ops-signal 算出了角度，ops-topic 不落就等于丢了。
    expect(topic).toMatch(/--angle/);

    // (d) --source 的取值必须就是 Rust 枚举那四个，多写一个就是被 store 拒。
    const rust = readFileSync(join(process.cwd(), 'src-tauri/src/ops_store.rs'), 'utf8');
    const enumBody = rust.match(/pub enum OpsTopicSource \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(enumBody).not.toBe('');
    const rustSources = [...enumBody.matchAll(/^\s{4}([A-Z]\w*),/gm)]
      .map((m) => m[1].toLowerCase())
      .sort();
    expect(rustSources).toEqual(['benchmark', 'hotspot', 'manual', 'reflection']);
    // SKILL.md 那句 `--source` 说明里，四个值都得在。
    const sourceLine = topic.split('\n').find((line) => line.includes('`--source`')) ?? '';
    for (const source of rustSources) expect(sourceLine, source).toContain(source);
    // 曾经写错的三个值不许回来。
    for (const ghost of ['system', 'clue', 'evolution']) {
      expect(sourceLine, ghost).not.toMatch(new RegExp(`\`${ghost}\``));
    }
  });

  it('72 小时不挂在硬门上 —— 它是分类规则，不是第二个可行性门', () => {
    // 历史事故：hot-riding.md 写「生命周期接到四道硬门第 3 条（超过 72 小时）」，
    // 而第 3 条实际是「可行性」。照做会拿「素材够不够」去卡「热点新不新」。
    // 现在它是分类规则：超过 72 小时改判常青题（--source manual），不毙掉。
    const body = readFileSync(join(SKILLS_ROOT, 'ops-signal/references/hot-riding.md'), 'utf8');
    expect(body).toMatch(/72 小时不是硬门/);
    expect(body).toMatch(/--source/);
    // 阶段边界只写一次：SKILL.md 不许再写 1–3 天那套旧口径。
    const signal = readFileSync(join(SKILLS_ROOT, 'ops-signal/SKILL.md'), 'utf8');
    expect(signal).not.toMatch(/衰退期（1–3 天）/);
    expect(signal).toMatch(/衰退期（24–72 小时）/);
  });

  it('简报不落盘 —— 存下来的榜会被当成今天的榜', () => {
    // 曾经的写法是「等定时任务产出的简报」，任务不存在；改成落盘又会留下另一坑：
    // 三天前的简报看起来和今天的榜一模一样，拿它选题产出的是一条过期选题。
    const signal = readFileSync(join(SKILLS_ROOT, 'ops-signal/SKILL.md'), 'utf8');
    expect(signal).toMatch(/简报不落盘/);
    const topic = readFileSync(join(SKILLS_ROOT, 'ops-topic/SKILL.md'), 'utf8');
    expect(topic).toMatch(/没有定时任务替你扫/);
    expect(topic).not.toMatch(/等定时任务产出/);
  });

  it('CLAUDE.md 的 skills 树和磁盘上的目录一一对应', () => {
    // 目录树是 Agent 的「这里有什么」清单。少列一个 skill，等于那一段的能力在
    // 主 prompt 里不存在 —— 想改对标的 Agent 不会去翻 ops-benchmark-analysis。
    // 多列一个，则是点向一个不存在的目录。
    const body = readFileSync(join(process.cwd(), 'agent-templates/sino/CLAUDE.md'), 'utf8');
    const tree = body.slice(body.indexOf('.claude/skills/'));
    // 树里最后一项用 `└──`，其余用 `├──` —— 只匹配前者会漏掉最后一个 skill。
    const listed = new Set(
      [...tree.matchAll(/^│\s+[├└]── (ops-[\w-]+)\//gm)].map((m) => m[1]),
    );
    const onDisk = new Set(
      readdirSync(SKILLS_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
    expect([...listed].sort()).toEqual([...onDisk].sort());
  });

  it('合规规则只有一份 —— 两份会分叉成「制作时放行、发布时拦下」', () => {
    // 原来合规规则只在 `ops-publish/references/publish-gates.md` §二。位置的问题不是
    // 重复，是**顺序**：脚本在 `ops-produce` 写成，一路跑到发布前才审 —— 违规脚本已经
    // 花完整条视频的钱。抽出来之后 `publish-gates` 只能指向它，不许自己再写一套。
    const gatePath = join(SKILLS_ROOT, 'ops-produce/references/compliance-gate.md');
    expect(existsSync(gatePath)).toBe(true);
    const gate = readFileSync(gatePath, 'utf8');
    // 具体规则得真在这份里（判定词是规则的证据，删掉就只剩一个标题）。
    expect(gate).toMatch(/绝对化用语/);
    expect(gate).toMatch(/导流外站/);
    expect(gate).toMatch(/诱导互动/);

    const publishGates = readFileSync(
      join(SKILLS_ROOT, 'ops-publish/references/publish-gates.md'),
      'utf8',
    );
    expect(publishGates).toContain('compliance-gate.md');
    // 副本的判据：这条规则如果两份都有，改一份另一份就静默过期。
    expect(publishGates).not.toMatch(/导流外站/);
    expect(publishGates).not.toMatch(/诱导互动/);
  });

  it('合规关跑在花钱之前，且自改循环有上限', () => {
    // 没有上限的自改会烧 token，而且越改越像在规避审查 —— 比原样违规更糟。
    // 没有「在 plan 阶段就跑」则等于这条关白抽。
    const skill = readFileSync(join(SKILLS_ROOT, 'ops-produce/SKILL.md'), 'utf8');
    expect(skill).toMatch(/合规关跑两次/);
    expect(skill).toMatch(/plan 确认前/);
    expect(skill).toMatch(/最多 3 轮/);

    const gate = readFileSync(
      join(SKILLS_ROOT, 'ops-produce/references/compliance-gate.md'),
      'utf8',
    );
    // 到上限后的三个兜底选项，缺一个 Agent 就会自己发明第四个（通常是"降级发布"）。
    for (const escape of ['放弃这条选题', '换形态做', '人工改写后重跑']) {
      expect(gate, escape).toContain(escape);
    }
    // 「删掉不过的项假装通过」是最隐蔽的失败形状，必须明文禁掉。
    expect(gate).toMatch(/不许把不过的项删掉/);
  });

  it('视频生成的工具链路写清了，且不锁模型名', () => {
    // 原来的第 4 步只写「确认后再生成」，没说拿什么生成、真实物料怎么进去 ——
    // 与本轮目标（必须结合资产库真实资产）断在这里。
    const skill = readFileSync(join(SKILLS_ROOT, 'ops-produce/SKILL.md'), 'utf8');
    expect(skill).toMatch(/generation-channels\.md/);

    const channels = readFileSync(
      join(SKILLS_ROOT, 'ops-produce/references/generation-channels.md'),
      'utf8',
    );
    // 参考图必须真的传进去，不能只在 prompt 里描写 —— 这是"结合真实资产"的落点。
    expect(channels).toMatch(/参考图必须真的传进去/);
    // 不许自己降级形态：用户以为拿到视频、实际拿到图文，比直接失败更坏。
    expect(channels).toMatch(/降级只能由人决定/);
    // gemini-image 的 edit_image 收不了本地参考图，写错了会让 Agent 拿它做产品图。
    expect(channels).toMatch(/不能\*\*当参考图通道/);
  });

  it('制作的两处收尾有人写 —— 素材 id 有出处、选题能走到 produced', () => {
    // 这两条都是「文档在，动作没人做」的断链：
    //
    // (a) 素材记录。skill 里一直只写 `ops update asset <id>`，而那个 id 从来没人
    //     产出 —— Agent 拿到派工第一步就没有落点。现在面板开工时建好并在派工
    //     消息里带 id，skill 必须说清这一点，否则 Agent 会自己 `ops add asset`
    //     再建一条，面板上挂两条同一选题的成品。
    // (b) 选题状态。做完只把素材置 ready、不把选题置 produced，主控每轮扫到
    //     `planned` 就重新派工 —— 同一条选题被反复做，钱也反复花。
    const skill = readFileSync(join(SKILLS_ROOT, 'ops-produce/SKILL.md'), 'utf8');
    expect(skill).toMatch(/素材记录由面板/);
    expect(skill).toMatch(/ops add asset/);
    expect(skill).toMatch(/--status produced/);
    expect(skill).toMatch(/两条都要写/);
  });

  it('开工入口在 planned 上也给 —— 只能点一次就是卡死', () => {
    // 面板的「开工」原来只在 status === 'idea' 时出现。开工写的是 planned，
    // 于是一次没跑完的开工（Agent 崩了 / 形态选错）就再也没有入口回到那里，
    // 那条选题永远停在 planned。这不是 UI 细节，是唯一能把 planned 推下去的按钮。
    const cards = readFileSync(
      join(process.cwd(), 'src/renderer/components/ops/OpsCards.tsx'),
      'utf8',
    );
    expect(cards).toMatch(/row\.status === 'idea' \|\| row\.status === 'planned'/);
  });

  it('SKILL.md 里提到的 references 都真的存在', () => {
    // skill 正文里写着「见 references/xxx.md」，那个文件要是没了，
    // Agent 读到的是一个断掉的指针 —— 它不会报错，只会照着没有的内容往下编。
    //
    // 路径按**相对这个文件的真实位置**解析，不假定同 skill：合规关抽出去之后，
    // `ops-publish` 的 SKILL.md 会用 `../ops-produce/references/…` 指别人的文件。
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
      for (const match of body.matchAll(/(?:\.\.?\/)*(?:[\w-]+\/)?references\/[\w.-]+\.md/g)) {
        const target = resolve(dirname(skillMd), match[0]);
        if (!existsSync(target)) missing.push(`${skill.name}: ${match[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
