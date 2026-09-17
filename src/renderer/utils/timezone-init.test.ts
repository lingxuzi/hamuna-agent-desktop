/**
 * timezone-init override smoke test — 验证 `Intl.DateTimeFormat` 默认注入 Asia/Shanghai。
 *
 * 关键断言：
 *  1) `new Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Shanghai'`
 *     —— 兜底场景：无任何参数时拿到的是我们注入的时区，不是 OS 时区。
 *  2) `new Date(...).toLocaleString()` 跟显式 `{ timeZone: 'Asia/Shanghai' }` 输出完全一致
 *     —— Date.toLocale* 内部就是 new Intl.DateTimeFormat，验证覆盖链没断。
 *  3) 显式传 `{ timeZone: 'Asia/Tokyo' }` 时 Tokyo 胜出（spread 让用户值覆盖默认）
 *     —— 保护 cron 任务"用户时区 = Tokyo"等主动选择路径不被吞。
 *  4) `Intl.DateTimeFormat.supportedLocalesOf(['en'], ...)` 仍可用
 *     —— 静态方法走 ES6 class extends 继承，验证 override 没碰坏。
 */
import { describe, expect, it } from 'vitest';

import './timezone-init';

describe('timezone-init', () => {
  it('Intl.DateTimeFormat() 默认 timeZone = Asia/Shanghai', () => {
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    expect(resolved.timeZone).toBe('Asia/Shanghai');
  });

  it('Date.toLocaleString() 输出 = Shanghai 时间（不是 OS locale）', () => {
    // 12:00 UTC → Shanghai 20:00 / Tokyo 21:00 / UTC 12:00 / New York 07:00。
    // Date.toLocaleString 内部就是 new Intl.DateTimeFormat(locales, options)，
    // 不传 timeZone 时拿到的应是 override 注入的 Asia/Shanghai；
    // 跟显式 { timeZone: 'Asia/Shanghai' } 应得同结果 —— 不是 tautology
    // （前者构造时拿到我们的 default，后者显式给 Tokyo 等时被 spread 覆盖），
    // 而是覆盖链没断的等价证明。
    const sample = new Date('2025-01-15T12:00:00Z');
    const opts: Intl.DateTimeFormatOptions = {
      hour: 'numeric', minute: '2-digit', hour12: false,
    };
    const fromToLocale = sample.toLocaleString('en-US', opts);
    const explicitShanghai = new Intl.DateTimeFormat('en-US', {
      ...opts, timeZone: 'Asia/Shanghai',
    }).format(sample);
    expect(fromToLocale).toBe(explicitShanghai);
    expect(fromToLocale).toBe('20:00'); // 12:00 UTC + 8h = 20:00；硬锚兜底 OS 在 Shanghai 也行
  });

  it('显式 timeZone 胜出（用户主动选 Tokyo 不被 Asia/Shanghai 吞）', () => {
    const sample = new Date('2025-06-15T00:00:00Z');
    const tokyo = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(sample);
    const shanghai = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(sample);
    // Tokyo (UTC+9) 比 Shanghai (UTC+8) 早 1 小时 → 字符串必不同
    expect(tokyo).not.toBe(shanghai);
    // 不传 timeZone 的应得 Shanghai 时间（不是 Tokyo）
    expect(shanghai).toBe(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(sample),
    );
  });

  it('supportedLocalesOf 静态方法继承可用', () => {
    const locales = Intl.DateTimeFormat.supportedLocalesOf(['en-US', 'zh-CN', 'xx-YY']);
    expect(locales).toContain('en-US');
    expect(locales).toContain('zh-CN');
  });
});