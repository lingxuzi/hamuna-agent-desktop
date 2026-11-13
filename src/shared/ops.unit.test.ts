import { describe, it, expect } from 'vitest';
import {
  OPS_ASSET_STATUSES,
  OPS_DOMAIN_IDS,
  OPS_RULE_SOURCES,
  OPS_RULE_STATUSES,
  OPS_STATE_VERSION,
  OPS_TOPIC_SOURCES,
  OPS_TOPIC_STATUSES,
  SINO_TEMPLATE_ID,
  emptyOpsState,
  isOpsAssetStatus,
  isOpsRuleSource,
  isOpsRuleStatus,
  isOpsTopicSource,
  isOpsTopicStatus,
} from './ops';

describe('ops 枚举', () => {
  it('只接受文档里列出的状态值', () => {
    expect(isOpsTopicStatus('idea')).toBe(true);
    expect(isOpsTopicStatus('planned')).toBe(true);
    expect(isOpsTopicStatus('produced')).toBe(true);
    expect(isOpsTopicStatus('dropped')).toBe(true);
    expect(isOpsTopicStatus('archived')).toBe(false);
    expect(isOpsTopicStatus('')).toBe(false);
    expect(isOpsTopicStatus(null)).toBe(false);
    expect(isOpsTopicStatus(undefined)).toBe(false);
    expect(isOpsTopicStatus(3)).toBe(false);
  });

  it('素材状态不接受排期态——排期是派生出来的位置，不是存储状态', () => {
    expect(isOpsAssetStatus('draft')).toBe(true);
    expect(isOpsAssetStatus('ready')).toBe(true);
    expect(isOpsAssetStatus('published')).toBe(true);
    expect(isOpsAssetStatus('scheduled')).toBe(false);
    expect(isOpsAssetStatus('pending')).toBe(false);
  });

  it('规则状态与来源分别判定', () => {
    expect(isOpsRuleStatus('proposed')).toBe(true);
    expect(isOpsRuleStatus('active')).toBe(true);
    expect(isOpsRuleStatus('retired')).toBe(false);
    expect(isOpsRuleSource('reflection')).toBe(true);
    expect(isOpsRuleSource('manual')).toBe(true);
    expect(isOpsRuleSource('dialog')).toBe(true);
    expect(isOpsRuleSource('auto')).toBe(false);
  });

  it('选题来源覆盖热点 / 对标 / 手动 / 复盘回流', () => {
    expect(OPS_TOPIC_SOURCES).toEqual(['hotspot', 'benchmark', 'manual', 'reflection']);
    expect(isOpsTopicSource('hotspot')).toBe(true);
    expect(isOpsTopicSource('trend')).toBe(false);
  });

  it('枚举清单与判定函数互相自洽', () => {
    for (const status of OPS_TOPIC_STATUSES) expect(isOpsTopicStatus(status)).toBe(true);
    for (const status of OPS_ASSET_STATUSES) expect(isOpsAssetStatus(status)).toBe(true);
    for (const status of OPS_RULE_STATUSES) expect(isOpsRuleStatus(status)).toBe(true);
    for (const source of OPS_RULE_SOURCES) expect(isOpsRuleSource(source)).toBe(true);
    for (const source of OPS_TOPIC_SOURCES) expect(isOpsTopicSource(source)).toBe(true);
  });

  it('四个域与模板 id 是稳定契约', () => {
    expect(OPS_DOMAIN_IDS).toEqual(['topic', 'asset', 'schedule', 'review']);
    expect(SINO_TEMPLATE_ID).toBe('sino');
  });
});

describe('emptyOpsState', () => {
  it('是合法空骨架，不是 undefined 字段', () => {
    const state = emptyOpsState();
    expect(state.version).toBe(OPS_STATE_VERSION);
    expect(state.topics).toEqual([]);
    expect(state.assets).toEqual([]);
    expect(state.reviews).toEqual([]);
    expect(state.rules).toEqual([]);
    expect(state.style).toBeNull();
  });

  it('每次调用返回新对象，不共享引用', () => {
    const a = emptyOpsState();
    const b = emptyOpsState();
    a.topics.push({} as never);
    expect(b.topics).toHaveLength(0);
  });
});
