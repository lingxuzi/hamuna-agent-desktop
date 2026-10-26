#!/usr/bin/env node
// wordcount.mjs — 社媒文案字数统计与目标字数校验（零依赖，只用 node 内置）。
//
// 为什么需要这个脚本：LLM 自数字数不可靠，而小红书 ≤20 字标题、抖音 ≤55 字
// 文案这类是硬约束。"写得差不多长"和"实测 23 字超了 3 个"是两回事。所以
// 判定交给脚本，改写交给模型。
//
// 用法（CWD = 工作区根）：
//   node scripts/wordcount.mjs count -f outputs/主题/copy.txt
//   echo "文本" | node scripts/wordcount.mjs count
//   node scripts/wordcount.mjs check --target 140 -f draft.txt
//   node scripts/wordcount.mjs check --target 20 --tolerance 0 < title.txt
//   node scripts/wordcount.mjs selftest
//
// 口径：社媒（微博 / 小红书等）按"计数字符数"——中文字符各计 1、英文单词各
// 计 1、数字串各计 1、标点/emoji 各计 1（贴近微博计法）。多口径同时输出。

import { readFileSync } from 'node:fs';
import { argv, exit, stdin } from 'node:process';

// CJK：基本区 + 扩展 A + 兼容表意 + 扩展 B 以上
const CJK = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u{20000}-\\u{2FFFF}';
const CJK_RE = new RegExp(`[${CJK}]`, 'gu');
// 英文/拉丁单词（连字符、撇号视作词内字符）
const WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
// 数字串（含小数点、千分位逗号）
const NUM_RE = /\d+(?:[.,]\d+)*/g;
// 标点/符号：非空白、非 CJK、非字母数字
const PUNCT_RE = new RegExp(`[^\\s0-9A-Za-z${CJK}]`, 'gu');

const hits = (text, re) => text.match(re)?.length ?? 0;

export function count(text) {
  const cjkChars = hits(text, CJK_RE);
  const enWords = hits(text, WORD_RE);
  const numGroups = hits(text, NUM_RE);
  const punct = hits(text, PUNCT_RE);
  return {
    cjk_chars: cjkChars,          // 中文（CJK）字符数 —— 社媒主看
    en_words: enWords,
    num_groups: numGroups,
    punct,
    total_chars: [...text].length,          // 总字符（按码点，emoji 计 1）
    no_space_chars: [...text.replace(/\s/g, '')].length,
    social_count: cjkChars + enWords + numGroups + punct,  // 社媒计数口径（判定用）
  };
}

export function check(text, target, tolerance = 0.05, metric = 'social_count') {
  const stats = count(text);
  const actual = stats[metric];
  const margin = Math.round(target * tolerance);
  const low = target - margin;
  const high = target + margin;

  let status, adjust, advice;
  if (actual < low) {
    status = 'under';
    adjust = low - actual;
    advice = `少了，至少再补 ${adjust} 字（当前 ${actual}，下限 ${low}）`;
  } else if (actual > high) {
    status = 'over';
    adjust = actual - high;
    advice = `超了，至少再删 ${adjust} 字（当前 ${actual}，上限 ${high}）`;
  } else {
    status = 'ok';
    adjust = 0;
    advice = `达标（${low} ≤ ${actual} ≤ ${high}）`;
  }

  return {
    pass: status === 'ok',
    status,
    metric,
    target,
    tolerance,
    range: [low, high],
    actual,
    adjust,
    advice,
    stats,
  };
}

function readInput(file) {
  if (file) return readFileSync(file, 'utf-8');
  const data = stdin.isTTY ? '' : readFileSync(0, 'utf-8');
  if (!data) {
    console.error('错误：没有输入。用 -f 指定文件，或通过 stdin 传入文本。');
    exit(2);
  }
  return data;
}

function print(obj, asJson) {
  if (asJson) {
    console.log(JSON.stringify(obj, null, 2));
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      console.log(`${k}:`);
      for (const [kk, vv] of Object.entries(v)) console.log(`  ${kk}: ${vv}`);
    } else {
      console.log(`${k}: ${Array.isArray(v) ? v.join(' ~ ') : v}`);
    }
  }
}

function parseArgs(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') o.json = true;
    else if (a === '-f' || a === '--file') o.file = args[++i];
    else if (a === '--target') o.target = Number(args[++i]);
    else if (a === '--tolerance') o.tolerance = Number(args[++i]);
    else if (a === '--metric') o.metric = args[++i];
    else o._.push(a);
  }
  return o;
}

function selftest() {
  const cases = [];
  let s = count('你好世界');
  cases.push(['cjk 4', s.cjk_chars === 4 && s.social_count === 4]);

  s = count('Hello world');
  cases.push(['en 2 words', s.en_words === 2 && s.social_count === 2]);

  s = count('我有 3 只猫 and 2 dogs');
  // 中文 4 + 数字 2 串 + 英文 2 词 = 8
  cases.push(['mixed', s.cjk_chars === 4 && s.en_words === 2 && s.num_groups === 2 && s.social_count === 8]);

  s = count('价格是 1,299.99 元');
  cases.push(['num group', s.num_groups === 1 && s.cjk_chars === 4]);

  cases.push(['check ok', check('一二三四五六七八九十', 10).status === 'ok']);
  cases.push(['check under', check('一二三', 10).status === 'under']);
  cases.push(['check over', check('一二三四五六七八九十一二三四五', 10).status === 'over']);
  cases.push(['empty target 0', check('', 0).pass]);
  // emoji 计 1、按码点不按 UTF-16 单元
  cases.push(['emoji', count('好😀').social_count === 2]);

  let ok = true;
  for (const [name, passed] of cases) {
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`);
    ok &&= passed;
  }
  return ok ? 0 : 1;
}

const o = parseArgs(argv.slice(2));
const cmd = o._[0];

if (cmd === 'selftest') exit(selftest());

const text = readInput(o.file);

if (cmd === 'count') {
  print(count(text), o.json);
} else if (cmd === 'check') {
  if (!Number.isFinite(o.target)) {
    console.error('错误：check 需要 --target <字数>');
    exit(2);
  }
  const r = check(text, o.target, o.tolerance ?? 0.05, o.metric ?? 'social_count');
  print(r, o.json);
  exit(r.pass ? 0 : 1);
} else {
  console.error('用法：wordcount.mjs <count|check|selftest> [...]');
  exit(2);
}
