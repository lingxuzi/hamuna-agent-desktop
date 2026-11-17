/**
 * 运营面板 bento 布局契约。
 *
 * 故障模式：卡片在网格里的位置由 ops.css 的 grid-template-areas 决定，组件
 * 增删卡片时位置表忘了同步 —— 多出来的卡被浏览器自动排位（挤掉别人的格子或
 * 掉到网格外），少掉的卡留出一个空洞；右栏两张卡若不在同一列，主区跟右栏就
 * 对不齐。这些都是纯视觉故障，jsdom 排不了版，只能把「位置表覆盖每一张实际
 * 渲染的卡」当成契约钉住。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import { emptyOpsState } from '../../../shared/ops';
import OpsPanel from './OpsPanel';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenWithCleanup: vi.fn(),
  isTauri: true,
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listenWithCleanup }));

// 同 Markdown.typography.test.tsx：jsdom 下 import.meta.url 会被改写成 http URL。
const css = readFileSync(join(process.cwd(), 'src/renderer/components/ops/ops.css'), 'utf8');

/** 卡片 class → 网格区域名。位置表里的名字必须跟 CSS 里声明的一致。 */
function areaByClass(): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of css.matchAll(/\.(ops-[a-z-]+)\s*\{[^}]*grid-area:\s*([a-z]+);/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

/** 每个域的位置表：域 → 行 → 格（格内是区域名）。 */
function areaTables(): Map<string, string[][]> {
  const tables = new Map<string, string[][]>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*grid-template-areas[^{}]*)\}/g)) {
    const domains = [...match[1].matchAll(/data-ops-domain='([a-z]+)'/g)].map((m) => m[1]);
    const body = match[2].match(/grid-template-areas:\s*([\s\S]*?);/);
    if (domains.length === 0 || !body) continue;
    const rows = body[1]
      .trim()
      .split('\n')
      .map((line) => line.trim().replace(/^'|'$/g, '').split(/\s+/));
    for (const domain of domains) tables.set(domain, rows);
  }
  return tables;
}

describe('运营面板 bento 位置表', () => {
  beforeEach(async () => {
    mocks.invoke.mockReset();
    mocks.listenWithCleanup.mockReset();
    mocks.invoke.mockResolvedValue(emptyOpsState());
    await i18n.changeLanguage('zh-CN');
  });

  it('每个域的位置表都覆盖该域实际渲染的每一张卡，且没有多余格子', async () => {
    const classToArea = areaByClass();
    const tables = areaTables();
    expect(classToArea.size).toBeGreaterThan(0);

    render(
      <ToastProvider>
        <OpsPanel workspace="/ws/sino" onClose={vi.fn()} onSendToAgent={vi.fn()} />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector('.ops-body')).toBeTruthy();
    });

    const user = userEvent.setup();
    for (const tab of ['方向', '选题', '素材', '排期', '复盘']) {
      await user.click(await screen.findByRole('tab', { name: tab }));
      const body = document.querySelector('.ops-body') as HTMLElement;
      const domain = body.dataset.opsDomain as string;
      const rows = tables.get(domain);
      expect(rows, `域 ${domain} 缺位置表`).toBeTruthy();
      if (!rows) continue;

      // 位置表本身：矩形网格 + 一个区域名只占一个连续矩形。
      const width = rows[0].length;
      expect(rows.every((row) => row.length === width), `${domain} 位置表行长不齐`).toBe(true);
      const cells = rows.flat();
      for (const name of new Set(cells)) {
        const hit = rows
          .map((row, r) => row.map((cell, c) => (cell === name ? [r, c] : null)).filter(Boolean))
          .flat() as [number, number][];
        const rs = hit.map(([r]) => r);
        const cs = hit.map(([, c]) => c);
        const box = (Math.max(...rs) - Math.min(...rs) + 1) * (Math.max(...cs) - Math.min(...cs) + 1);
        expect(box, `${domain} 的区域 ${name} 不是连续矩形`).toBe(hit.length);
      }

      // 位置表 ⊇ 实际渲染的卡：多一张卡会被自动排位，少一张卡会留空洞。
      const rendered = [...body.querySelectorAll('.ops-hero, .ops-next, .ops-c-top, .ops-c-bars, .ops-c-chart, .ops-c-adv, .ops-c-bench, .ops-c-note')]
        .map((el) => classToArea.get([...el.classList].find((c) => classToArea.has(c)) ?? ''))
        .filter((area): area is string => Boolean(area));
      expect(new Set(rendered).size, `${domain} 有两张卡落在同一个区域`).toBe(rendered.length);
      expect([...new Set(cells)].sort(), `${domain} 位置表与实际渲染的卡不一致`).toEqual(
        [...new Set(rendered)].sort(),
      );
    }
  });

  it('右栏两张卡落在同一列，主区与右栏才对得齐', () => {
    const tables = areaTables();
    for (const [domain, rows] of tables) {
      const columnOf = (name: string) => rows.findIndex((row) => row.includes(name));
      const columnIndex = (name: string) => rows[columnOf(name)].indexOf(name);
      expect(columnIndex('dark'), `${domain} 的深墨卡不在右栏`).toBe(columnIndex('notes'));
    }
  });
});
