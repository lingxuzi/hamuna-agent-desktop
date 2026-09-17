#!/usr/bin/env node
// Live 一次性验证：拿已知 key 直调 /v1/models，验当前端到端可用。
// 与 src/server/nxgd-auth.ts::fetchModels 第 497 行同 headers / 同 URL。
// 用法：node scripts/test-nxgd-fetch-models-live.mjs
//       API_KEY=sk-xxx node scripts/test-nxgd-fetch-models-live.mjs

import process from 'node:process';

const API_KEY = process.env.API_KEY || 'sk-Ofg4mIVzGbuNc1fi3FmZWOzFrwF370OG04NejTEMzj0';
const URL = 'https://ai-models.cloudwasu.cn/v1/models?limit=100';

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15000);

console.log(`[live] fetchModels-equivalent`);
console.log(`  url:   ${URL}`);
console.log(`  key:   ${API_KEY.slice(0, 7)}... (prefix)`);

try {
  const resp = await fetch(URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'anthropic-version': '2023-06-01',
    },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  console.log(`  status: ${resp.status} ${resp.statusText}`);

  if (resp.status === 401) {
    console.log(`  → 401: key 失效（与 fetchModels 401 自愈路径对应）`);
    process.exit(1);
  }
  if (resp.status === 429) {
    const retryAfter = resp.headers.get('retry-after');
    console.log(`  → 429: 限流（与 fetchModels cooldown 路径对应） retry-after=${retryAfter ?? 'n/a'}`);
    process.exit(1);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.log(`  → !ok: body=${body.slice(0, 200)}`);
    process.exit(1);
  }

  const body = await resp.json();
  const models = Array.isArray(body.data) ? body.data : [];
  console.log(`  → 200: ${models.length} models`);
  for (const m of models) {
    console.log(`     - ${m.id}${m.display_name ? `  (${m.display_name})` : ''}`);
  }
  process.exit(0);
} catch (err) {
  clearTimeout(timeout);
  console.log(`  → threw: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
