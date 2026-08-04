import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const SHOTS = 'v2-shots/verify';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const url = 'http://localhost:5174/';
console.log('→', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.app', { timeout: 10000 });
await page.waitForTimeout(400);

const shot = (name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
const results: Record<string, { ok: boolean; note: string }> = {};

async function clickAndCheck(name: string, selector: string, fn?: () => Promise<string>) {
  try {
    const el = page.locator(selector).first();
    const exists = await el.count();
    if (!exists) {
      results[name] = { ok: false, note: `selector not found: ${selector}` };
      return;
    }
    const note = await fn?.() ?? '';
    await el.click({ timeout: 2000 });
    await page.waitForTimeout(200);
    results[name] = { ok: true, note };
  } catch (e) {
    results[name] = { ok: false, note: `click failed: ${e instanceof Error ? e.message : e}` };
  }
}

// ============================================================
// 1. Launcher — quick cards / workspaces / sessions / nav rail
// ============================================================
console.log('\n# 1. Launcher');
await shot('01-launcher-init');
// Wait for async data: sessions / workspaces may load after React render
await page.waitForTimeout(2500);
await page.waitForSelector('.quick-card, .ws-empty', { timeout: 5000 }).catch(() => {});
const quickCards = await page.locator('.quick-card').count();
const wsCards = await page.locator('.ws-card').count();
const sessionRows = await page.locator('.launcher-rail .session-row').count();
console.log(`  quick-cards=${quickCards} workspaces=${wsCards} session-rows=${sessionRows}`);

// Wait for session rows to appear before clicking
if (sessionRows > 0) {
  await page.locator('.launcher-rail .session-row').first().waitFor({ timeout: 5000 }).catch(() => {});
}
await clickAndCheck('launcher:click-quickcard-0', '.quick-card:nth-of-type(1)');
await clickAndCheck('launcher:click-workspace-0', '.workspace-list .ws-card:nth-of-type(1)');
await clickAndCheck('launcher:click-session-row-0', '.launcher-rail .session-row >> nth=0');
await clickAndCheck('launcher:click-add-workspace', '.launcher-rail .eyebrow button:has-text("+ 添加")');
await clickAndCheck('launcher:click-search', '.launcher-rail .eyebrow button:has-text("搜索")');

// NavRail — click each
for (const [name, label] of [
  ['launcher:nav-rail-launcher', '启动器'],
  ['launcher:nav-rail-chat', '对话'],
  ['launcher:nav-rail-settings', '设置'],
  ['launcher:nav-rail-tasks', '任务'],
  ['launcher:nav-rail-space', '协作'],
] as const) {
  await clickAndCheck(name, `.nav-rail a:has-text("${label}")`);
}
await shot('02-after-nav-all');

// ============================================================
// 2. Chat
// ============================================================
console.log('\n# 2. Chat');
await page.locator('.nav-rail a:has-text("对话")').click();
await page.waitForTimeout(400);
await shot('03-chat-init');

// Wait for async session list load
await page.waitForTimeout(1200);
const sessionListItems = await page.locator('.chat-sidebar .session-row').count();
console.log(`  sidebar session-rows=${sessionListItems}`);

for (let i = 0; i < Math.min(sessionListItems, 3); i++) {
  await clickAndCheck(`chat:click-sidebar-session-${i}`, `.chat-sidebar .session-row >> nth=${i}`);
}
await clickAndCheck('chat:click-share', '.chat-main .eyebrow button:has-text("分享")');

// input + send
const textarea = page.locator('.chat-input textarea');
await textarea.fill('hello from v2 e2e');
await shot('04-chat-typed');
await clickAndCheck('chat:click-send', '.chat-input button.send');

// 发送按钮存在且可点(浏览器 dev 无 Management API,真实发送会 503 —
// 这是环境限制,不是 UI 缺陷;Tauri 下发送链路完整)
const sendBtn = await page.locator('.chat-input button.send').count();
results['chat:send-button-exists'] = { ok: sendBtn > 0, note: `send btn=${sendBtn}` };
await page.waitForTimeout(300);
await shot('05-chat-after-send');

// ============================================================
// 3. Settings
// ============================================================
console.log('\n# 3. Settings');
await page.locator('.nav-rail a:has-text("设置")').click();
await page.waitForTimeout(300);
await shot('06-settings-init');

const navItems = await page.locator('.settings-sidebar .settings-nav-item').count();
console.log(`  settings nav-items=${navItems}`);

for (const label of ['外观', '快捷键', '语言', '更新', '模型', '技能', '定时任务', 'MCP 服务', 'Provider', '日志', '关于']) {
  const ok = await page.locator(`.settings-sidebar .settings-nav-item:has-text("${label}")`).count();
  if (ok) {
    await clickAndCheck(`settings:click-nav-${label}`, `.settings-sidebar .settings-nav-item:has-text("${label}")`);
    await page.waitForTimeout(120);
  }
}
await shot('07-settings-nav-walked');

// back to 外观 and toggle Segmented/Theme/Toggle
await page.locator('.settings-sidebar .settings-nav-item:has-text("外观")').click();
await page.waitForTimeout(200);

for (const segLabel of ['亮色', '暗色', '系统']) {
  await clickAndCheck(`settings:color-${segLabel}`, `.segmented button:has-text("${segLabel}")`);
}
for (const tileName of ['Default', 'Fintech · Gold', 'Sage', 'Linear']) {
  await clickAndCheck(`settings:theme-${tileName}`, `.theme-tile:has-text("${tileName}")`);
}
for (const d of ['紧凑', '标准', '宽松']) {
  await clickAndCheck(`settings:density-${d}`, `.settings-row:has-text("界面密度") .segmented button:has-text("${d}")`);
}
for (const f of ['系统', 'JetBrains', 'Sarasa']) {
  await clickAndCheck(`settings:font-${f}`, `.settings-row:has-text("终端字体") .segmented button:has-text("${f}")`);
}

// toggles — 3 个
const toggles = page.locator('.toggle');
const tCount = await toggles.count();
console.log(`  toggles=${tCount}`);
for (let i = 0; i < tCount; i++) {
  await clickAndCheck(`settings:toggle-${i}`, `.toggle >> nth=${i}`);
  await page.waitForTimeout(80);
}

// eyebrow actions
for (const btnLabel of ['导入', '导出', '恢复默认']) {
  await clickAndCheck(`settings:eyebrow-${btnLabel}`, `.eyebrow button:has-text("${btnLabel}")`);
}
await shot('08-settings-end');

// ============================================================
// 4. Tasks
// ============================================================
console.log('\n# 4. Tasks');
await page.locator('.nav-rail a:has-text("任务")').click();
await page.waitForTimeout(300);
await shot('09-tasks-init');

const taskNavItems = await page.locator('.tasks-sidebar .nav-item').count();
console.log(`  tasks nav-items=${taskNavItems}`);

for (const v of ['▣ 全部', '▶ 运行中', '✓ 已完成', '⚠ 阻塞', '⏸ 暂停', '▢ 待开始']) {
  await clickAndCheck(`tasks:view-${v}`, `.tasks-sidebar .nav-item:has-text("${v}")`);
  await page.waitForTimeout(100);
}
for (const c of ['⏰ 定时', '⌗ 手动', '✦ 自动触发', '⎌ 归档']) {
  await clickAndCheck(`tasks:cat-${c}`, `.tasks-sidebar .nav-item:has-text("${c}")`);
  await page.waitForTimeout(100);
}
for (const btnLabel of ['新建', '刷新']) {
  await clickAndCheck(`tasks:eyebrow-${btnLabel}`, `.eyebrow button:has-text("${btnLabel}")`);
}
await shot('10-tasks-end');

// ============================================================
// 5. Space
// ============================================================
console.log('\n# 5. Space');
await page.locator('.nav-rail a:has-text("协作")').click();
await page.waitForTimeout(300);
await shot('11-space-init');

for (const n of ['▣ 议题', '⚡ 技能', '⌬ 代理', '⊕ 目标', '⚙ 设置']) {
  await clickAndCheck(`space:nav-${n}`, `.space-sidebar .nav-item:has-text("${n}")`);
  await page.waitForTimeout(80);
}
for (const f of ['▢ 待处理', '▶ 进行中', '✓ 已完成', '⚠ 阻塞']) {
  await clickAndCheck(`space:filter-${f}`, `.space-sidebar .nav-item:has-text("${f}")`);
  await page.waitForTimeout(80);
}

const issues = await page.locator('.space-main .issue-row').count();
console.log(`  issues=${issues}`);
for (let i = 0; i < issues; i++) {
  await clickAndCheck(`space:click-issue-${i}`, `.space-main .issue-row >> nth=${i}`);
  await page.waitForTimeout(80);
}

// Space 空态(未登录):按钮应存在但 disabled — 验证"正确禁用"而非"可点"
for (const btnLabel of ['新建议题', '排序', '导出']) {
  const btn = page.locator(`.eyebrow button:has-text("${btnLabel}")`).first();
  const count = await btn.count();
  let disabled = false;
  if (count) disabled = await btn.isDisabled();
  results[`space:eyebrow-${btnLabel}`] = { ok: count > 0 && disabled, note: count ? `disabled=${disabled}` : 'not found' };
}
await shot('12-space-end');

// ============================================================
// 6. TabBar — add / close / click
// ============================================================
console.log('\n# 6. TabBar');
await page.locator('.nav-rail a:has-text("对话")').click();
await page.waitForTimeout(200);

const initialTabs = await page.locator('.tab').count();
console.log(`  initial tabs=${initialTabs}`);

await clickAndCheck('tabbar:click-add', '.tab-add');
await page.waitForTimeout(200);
await shot('13-tab-added');

const tabsAfterAdd = await page.locator('.tab').count();
results['tabbar:tab-count-after-add'] = { ok: tabsAfterAdd === initialTabs + 1, note: `${initialTabs}→${tabsAfterAdd}` };

// add a couple more
await page.locator('.tab-add').click();
await page.waitForTimeout(200);
await page.locator('.tab-add').click();
await page.waitForTimeout(200);
await shot('14-tabs-multi');
const tabsNow = await page.locator('.tab').count();
results['tabbar:tabs-multi-count'] = { ok: tabsNow === initialTabs + 3, note: `now=${tabsNow}` };

// click each non-active tab to switch
for (let i = 1; i < tabsNow; i++) {
  await clickAndCheck(`tabbar:click-tab-${i}`, `.tab >> nth=${i}`);
  await page.waitForTimeout(120);
}

// close all non-pinned tabs
const closeBtns = await page.locator('.tab .close').count();
console.log(`  close buttons=${closeBtns}`);
for (let i = 0; i < closeBtns; i++) {
  const cb = page.locator('.tab .close').first();
  await cb.click({ timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(80);
}
const tabsAfterClose = await page.locator('.tab').count();
results['tabbar:tabs-after-close'] = { ok: tabsAfterClose === 1, note: `now=${tabsAfterClose}` };
await shot('15-tabs-closed');

// ============================================================
// 7. TitleBar cluster buttons
// ============================================================
console.log('\n# 7. TitleBar');
for (const label of ['帮助', '更新', 'Team', '任务', '设置']) {
  await clickAndCheck(`titlebar:${label}`, `.titlebar-cluster button:has-text("${label}")`);
}
await shot('16-titlebar-clicked');

// ============================================================
// 8. Keyboard shortcuts ⌘1..⌘5
// ============================================================
console.log('\n# 8. Keyboard shortcuts');
for (const [k, surface] of [['1', 'launcher'], ['2', 'chat'], ['3', 'settings'], ['4', 'tasks'], ['5', 'space']] as const) {
  await page.keyboard.down('Control');
  await page.keyboard.press(k);
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  const active = await page.locator('.nav-rail a.active').textContent();
  results[`shortcut:Ctrl+${k}`] = {
    ok: !!active && active.includes(surface === 'launcher' ? '启动器' : surface === 'chat' ? '对话' : surface === 'settings' ? '设置' : surface === 'tasks' ? '任务' : '协作'),
    note: `expected=${surface} got="${active?.trim()}"`,
  };
  await shot(`17-shortcut-${surface}`);
}

// ============================================================
// Report
// ============================================================
const lines: string[] = [];
let okCount = 0, failCount = 0;
for (const [k, v] of Object.entries(results)) {
  const mark = v.ok ? '✓' : '✗';
  if (v.ok) okCount++; else failCount++;
  lines.push(`${mark} ${k.padEnd(48)} ${v.note}`);
}
lines.push('');
lines.push(`PASS=${okCount}  FAIL=${failCount}  TOTAL=${okCount + failCount}`);
lines.push('');
lines.push(`Console errors: ${errors.length}`);
for (const e of errors) lines.push(`  ${e}`);

writeFileSync(join(SHOTS, 'report.txt'), lines.join('\n'));
console.log('\n=== REPORT ===');
console.log(lines.join('\n'));
await browser.close();