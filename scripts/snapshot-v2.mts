import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

mkdirSync('v2-shots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const url = 'http://localhost:5174/';
console.log('Loading', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.app', { timeout: 10000 });
await page.waitForTimeout(500);

const surfaces = [
  { name: 'launcher', key: '1' },
  { name: 'chat', key: '2' },
  { name: 'settings', key: '3' },
  { name: 'tasks', key: '4' },
  { name: 'space', key: '5' },
];

const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

for (const s of surfaces) {
  await page.keyboard.down('Control');
  await page.keyboard.press(s.key);
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `v2-shots/${s.name}.png`, fullPage: false });
  console.log(`captured ${s.name}`);
}

// 新建 tab → chat 隔离演示
await page.keyboard.down('Control');
await page.keyboard.press('2');
await page.keyboard.up('Control');
await page.waitForTimeout(250);
// 点 + 按钮（在 tabbar 内）
const plusBtn = await page.locator('.tab-add').first();
await plusBtn.click({ timeout: 2000 }).catch(() => console.log('no plus clickable'));
await page.waitForTimeout(300);
await page.screenshot({ path: 'v2-shots/tabs-multi.png', fullPage: false });
console.log('captured tabs-multi');

writeFileSync('v2-shots/console-errors.txt', errors.join('\n'));
console.log('errors captured:', errors.length);
await browser.close();