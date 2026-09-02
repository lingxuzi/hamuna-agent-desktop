#!/usr/bin/env node
// kb-verify-stats.mjs — A/B ROI aggregator for KB relation extraction precision.
//
// Reads `~/.hamuna/logs/unified-{date}.log` and aggregates the per-chunk
// counters emitted by `kb-relations.ts`. ZERO additional LLM cost — we are
// re-using the production logs that already capture the data.
//
// Output answers three questions for the operator:
//   1. Is char_interval being used? (model follows the new schema?)
//   2. How many entities does mechanical grounding drop?
//   3. How many additional entities does the LLM self-verification pass drop?
//
// Together (2) + (3) = "how much garbage does precision remove", which is
// the ROI signal. If both numbers are 0, the prompt/schema is working
// perfectly and verify mode is paying only its token cost. If (2) > 0,
// char_interval adoption matters. If (3) > 0, the LLM self-verify is
// catching things mechanical grounding missed.
//
// Usage:
//   node scripts/kb-verify-stats.mjs                 # default: last 7 days
//   node scripts/kb-verify-stats.mjs --days 30
//   node scripts/kb-verify-stats.mjs --date 2026-09-01

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.hamuna', 'logs');

// ── args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let days = 7;
let singleDate = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--days' && args[i + 1]) { days = parseInt(args[i + 1], 10); i++; }
  else if (args[i] === '--date' && args[i + 1]) { singleDate = args[i + 1]; i++; }
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node scripts/kb-verify-stats.mjs [--days N | --date YYYY-MM-DD]');
    process.exit(0);
  }
}

// ── pick log files ──────────────────────────────────────────────────────
if (!existsSync(LOG_DIR)) {
  console.error(`log dir not found: ${LOG_DIR}`);
  process.exit(1);
}

let logFiles;
if (singleDate) {
  const f = join(LOG_DIR, `unified-${singleDate}.log`);
  if (!existsSync(f)) { console.error(`log not found: ${f}`); process.exit(1); }
  logFiles = [f];
} else {
  const all = readdirSync(LOG_DIR).filter((f) => /^unified-\d{4}-\d{2}-\d{2}\.log$/.test(f));
  all.sort(); // YYYY-MM-DD lex-sort matches chronological
  logFiles = all.slice(-days).map((f) => join(LOG_DIR, f));
}
if (logFiles.length === 0) {
  console.error('no log files matched');
  process.exit(1);
}

// ── parse ───────────────────────────────────────────────────────────────
const stats = {
  chunksProcessed: 0,
  preliminaryEntities: 0,
  preliminaryRelations: 0,
  groundedEntities: 0,
  groundedRelations: 0,
  droppedByGroundingEntities: 0,
  droppedByGroundingRelations: 0,
  droppedByVerifyEntities: 0,
  charIntervalHits: 0,
};

const lineRe = /\[kb-relations\] (?:(?<verify>direct-http|sdk-fallback|sdk-retry) parsed=(?<pE>\d+)e\/(?<pR>\d+)r grounded=(?<gE>\d+)e\/(?<gR>\d+)r dropped=(?<dE>\d+)e\/(?<dR>\d+)r charIntervalUsed=(?<ciU>\d+))|(?<selfVerify>self-verify dropped (?<svN>\d+) additional entities)/;

for (const file of logFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.includes('[kb-relations]')) continue;
    const m = lineRe.exec(line);
    if (!m || !m.groups) continue;
    if (m.groups.verify) {
      stats.chunksProcessed++;
      stats.preliminaryEntities += parseInt(m.groups.pE, 10);
      stats.preliminaryRelations += parseInt(m.groups.pR, 10);
      stats.groundedEntities += parseInt(m.groups.gE, 10);
      stats.groundedRelations += parseInt(m.groups.gR, 10);
      stats.droppedByGroundingEntities += parseInt(m.groups.dE, 10);
      stats.droppedByGroundingRelations += parseInt(m.groups.dR, 10);
      stats.charIntervalHits += parseInt(m.groups.ciU, 10);
    } else if (m.groups.selfVerify) {
      stats.droppedByVerifyEntities += parseInt(m.groups.svN, 10);
    }
  }
}

// ── render ──────────────────────────────────────────────────────────────
const pct = (num, denom) => (denom === 0 ? '0.0%' : ((100 * num) / denom).toFixed(1) + '%');
console.log(`=== KB relation extraction stats (${logFiles.length} log file(s)) ===`);
console.log(`log files:`);
for (const f of logFiles) console.log(`  ${f}`);
console.log('');
console.log('Throughput:');
console.log(`  chunks processed:           ${stats.chunksProcessed}`);
console.log(`  preliminary entities:       ${stats.preliminaryEntities}`);
console.log(`  preliminary relations:      ${stats.preliminaryRelations}`);
console.log('');
console.log('Mechanical grounding (substring + char_interval cross-check):');
console.log(`  kept entities:              ${stats.groundedEntities}`);
console.log(`  kept relations:             ${stats.groundedRelations}`);
console.log(`  dropped entities:           ${stats.droppedByGroundingEntities}  (${pct(stats.droppedByGroundingEntities, stats.preliminaryEntities)} of preliminary)`);
console.log(`  dropped relations:          ${stats.droppedByGroundingRelations}  (${pct(stats.droppedByGroundingRelations, stats.preliminaryRelations)} of preliminary)`);
console.log('');
console.log('LLM self-verification pass:');
console.log(`  additional entities dropped: ${stats.droppedByVerifyEntities}`);
console.log('');
console.log('char_interval adoption:');
console.log(`  entities with valid char_interval: ${stats.charIntervalHits} / ${stats.preliminaryEntities} (${pct(stats.charIntervalHits, stats.preliminaryEntities)})`);
console.log('');
console.log('ROI signal:');
const totalDropped = stats.droppedByGroundingEntities + stats.droppedByVerifyEntities;
console.log(`  total garbage removed:      ${totalDropped} / ${stats.preliminaryEntities} preliminary (${pct(totalDropped, stats.preliminaryEntities)})`);
