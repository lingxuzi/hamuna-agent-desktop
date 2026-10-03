/**
 * `appDataWorkspace` 归一的判定表。这层是纯字符串的，所以值得把每个拒绝理由
 * 各钉一条 —— 尤其是尾随点和保留设备名：它们在 Linux/macOS 上完全无害，只在
 * Windows 上变成别名或设备句柄，跨平台跑测试最容易漏掉的正是这一类。
 */

import { describe, it, expect } from 'vitest';
import { normalizeAppDataWorkspace } from './app-data-workspace';

describe('normalizeAppDataWorkspace', () => {
  describe('accepted', () => {
    it('treats an absent value as "use the appdata root"', () => {
      expect(normalizeAppDataWorkspace(undefined)).toEqual({ ok: true, segment: '' });
      expect(normalizeAppDataWorkspace(null)).toEqual({ ok: true, segment: '' });
    });

    it('keeps an ordinary directory name verbatim', () => {
      expect(normalizeAppDataWorkspace('notes')).toEqual({ ok: true, segment: 'notes' });
    });

    it('trims surrounding whitespace rather than rejecting it', () => {
      expect(normalizeAppDataWorkspace('  notes  ')).toEqual({ ok: true, segment: 'notes' });
    });

    it('normalizes a trailing space, which used to look rejected but never was', () => {
      // 曾经有一条 `endsWith(' ')` 的拒绝分支，但它跑在 `raw.trim()` **之后**，
      // 所以恒为 false —— 尾随空格其实一直被归一成不带空格的同名目录。
      //
      // 归一是对的：Win32 本来就会静默剥掉尾随空格，trim 之后各平台拿到的是同一个
      // 名字，没有别名可言；而"在 Linux 上建一个 Windows 根本没法寻址的目录"
      // （`'trailing '` 与 `'trailing'` 在 Linux 上是两个不同目录）才是真坑。
      //
      // 那条死分支已删。留这条测试是为了把**归一**钉成显式契约，而不是让下一个人
      // 看着文档以为尾随空格被拒、转头去 Rust 那侧加一条对不上的规则。
      expect(normalizeAppDataWorkspace('trailing ')).toEqual({ ok: true, segment: 'trailing' });
      // 与 Rust `resolve_miniapp_agent_workspace` 的断言同形：两边必须一致。
      expect(normalizeAppDataWorkspace('trailing ')).toEqual(
        normalizeAppDataWorkspace('trailing'),
      );
    });

    it('allows interior dots, which are ordinary filename characters', () => {
      expect(normalizeAppDataWorkspace('my.notes.v2')).toEqual({ ok: true, segment: 'my.notes.v2' });
    });

    it('allows non-ASCII names', () => {
      expect(normalizeAppDataWorkspace('笔记')).toEqual({ ok: true, segment: '笔记' });
    });

    it('allows a name that merely contains a reserved stem as a substring', () => {
      // `console` 只是含 con，不是 con 设备；早期版本的前缀匹配会误杀它。
      expect(normalizeAppDataWorkspace('console')).toEqual({ ok: true, segment: 'console' });
    });
  });

  describe('rejected', () => {
    it('rejects an explicit empty or whitespace-only name', () => {
      // 与 undefined 区分：undefined 是"用默认"，'' 是作者写了没意义的东西。
      expect(normalizeAppDataWorkspace('')).toEqual({
        ok: false,
        reason: 'appDataWorkspace must not be empty',
      });
      expect(normalizeAppDataWorkspace('   ').ok).toBe(false);
    });

    it('rejects a non-string', () => {
      expect(normalizeAppDataWorkspace(42)).toEqual({
        ok: false,
        reason: 'appDataWorkspace must be a string',
      });
      expect(normalizeAppDataWorkspace({}).ok).toBe(false);
      expect(normalizeAppDataWorkspace(['notes']).ok).toBe(false);
    });

    it('rejects anything that is more than one path segment', () => {
      for (const bad of ['a/b', '..\\..\\etc', 'C:/Users', 'a\\b']) {
        expect(normalizeAppDataWorkspace(bad).ok, bad).toBe(false);
      }
    });

    it('rejects path characters that cannot appear in a directory name', () => {
      for (const bad of ['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
        expect(normalizeAppDataWorkspace(bad).ok, bad).toBe(false);
      }
    });

    it('rejects control characters, including an embedded NUL', () => {
      expect(normalizeAppDataWorkspace('a\u0000b').ok).toBe(false);
      expect(normalizeAppDataWorkspace('a\nb').ok).toBe(false);
      expect(normalizeAppDataWorkspace('a\tb').ok).toBe(false);
    });

    it('rejects the relative-directory aliases', () => {
      expect(normalizeAppDataWorkspace('.').ok).toBe(false);
      expect(normalizeAppDataWorkspace('..').ok).toBe(false);
    });

    it('rejects a trailing dot, which Win32 would strip into an alias', () => {
      // `work.` 与 `work` 在 NTFS 上是同一个目录；放行等于给作者一个会静默
      // 指向别处的名字。
      expect(normalizeAppDataWorkspace('work.').ok).toBe(false);
    });

    it('rejects a leading dot', () => {
      expect(normalizeAppDataWorkspace('.hidden').ok).toBe(false);
    });

    it('rejects reserved Windows device names, case-insensitively', () => {
      for (const bad of ['CON', 'con', 'NUL', 'aux', 'COM1', 'lpt9', 'PRN']) {
        expect(normalizeAppDataWorkspace(bad).ok, bad).toBe(false);
      }
    });

    it('rejects a reserved device name that carries an extension', () => {
      // `CON.txt` 同样打向 CON 设备，所以判定看第一个点之前的那段。
      expect(normalizeAppDataWorkspace('CON.txt').ok).toBe(false);
      expect(normalizeAppDataWorkspace('nul.json').ok).toBe(false);
    });

    it('rejects a name longer than the cap', () => {
      expect(normalizeAppDataWorkspace('a'.repeat(64)).ok).toBe(true);
      expect(normalizeAppDataWorkspace('a'.repeat(65)).ok).toBe(false);
    });
  });

  it('never returns a segment that could escape its parent', () => {
    // 纵深断言：所有被接受的输入里不应出现分隔符或相对段，
    // 这样调用方拼路径时不必再逐个 case 地提防。
    const samples = [
      undefined,
      'notes',
      'my.notes.v2',
      'console',
      '笔记',
      'a'.repeat(64),
    ];
    for (const sample of samples) {
      const r = normalizeAppDataWorkspace(sample);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.segment).not.toContain('/');
      expect(r.segment).not.toContain('\\');
      expect(r.segment).not.toBe('.');
      expect(r.segment).not.toBe('..');
    }
  });
});
