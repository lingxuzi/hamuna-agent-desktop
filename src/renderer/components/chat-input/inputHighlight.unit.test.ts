import { describe, it, expect } from 'vitest';
import { tokenizeForHighlight } from './inputHighlight';

const types = (s: string) => tokenizeForHighlight(s).map((t) => t.type);
const texts = (s: string) => tokenizeForHighlight(s).map((t) => t.text);
const joined = (s: string) => texts(s).join('');

describe('tokenizeForHighlight', () => {
  it('marks /skill at start', () => {
    expect(types('/hamuna-cron 帮我建个定时任务')).toEqual(['skill', 'plain']);
  });

  it('marks @file mid-text after whitespace', () => {
    expect(types('看看 @src/app.tsx 再说')).toEqual(['plain', 'asset', 'plain']);
    expect(texts('看看 @src/app.tsx 再说')[1]).toBe('@src/app.tsx');
  });

  it('does not mark URLs or emails', () => {
    expect(types('https://example.com/a')).toEqual(['plain']);
    expect(types('mail me at bob@example.com')).toEqual(['plain']);
  });

  it('does not mark mid-word slash', () => {
    expect(types('and/or')).toEqual(['plain']);
  });

  it('reconstructs the original text exactly', () => {
    for (const s of ['/a @b c', '', 'plain', '@x', 'a  /b\t@c', '/a.b:c/d']) {
      expect(joined(s)).toBe(s);
    }
  });

  it('reports ranges that cut exactly the marker back out', () => {
    const text = '前 /skill 后 @a/b.ts 尾';
    const tok = tokenizeForHighlight(text).find((t) => t.type === 'asset')!;
    expect(text.slice(tok.start, tok.end)).toBe('@a/b.ts');
    const skill = tokenizeForHighlight(text).find((t) => t.type === 'skill')!;
    expect(text.slice(skill.start, skill.end)).toBe('/skill');
  });

  it('leaves trailing sentence punctuation out of the asset marker', () => {
    const text = '看看 @a/b.ts，然后继续。';
    const tok = tokenizeForHighlight(text).find((t) => t.type === 'asset')!;
    expect(tok.text).toBe('@a/b.ts');
    expect(joined(text)).toBe(text);
  });
});
