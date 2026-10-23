import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const geo = async (label) => {
  const r = await page.evaluate(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return {l:b.left,t:b.top,w:b.width,h:b.height,cy:b.top+b.height/2,cx:b.left+b.width/2}; };
    return { settings: pick('[aria-label="设置"]'), bell: pick('[aria-label="通知"]') };
  });
  console.log(label, JSON.stringify(r));
};
await geo('expanded');
const btn = page.locator('[aria-label*="收起"], [aria-label*="Collapse"]').first();
if (await btn.count()) { await btn.click(); }
await page.waitForTimeout(700);
await geo('rail');
await browser.close();
