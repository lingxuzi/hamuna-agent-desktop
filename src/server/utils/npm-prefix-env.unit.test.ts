import { describe, expect, it } from 'vitest';

import {
  getHamunaAgentNpmGlobalBinDir,
  getHamunaAgentNpmGlobalPrefix,
  scrubHamunaAgentNpmPrefixEnv,
} from './npm-prefix-env';

describe('npm prefix env utilities', () => {
  it('builds the HamunaAgent npm global prefix and bin dir per platform', () => {
    expect(getHamunaAgentNpmGlobalPrefix('/Users/tester', 'darwin')).toBe('/Users/tester/.hamuna/npm-global');
    expect(getHamunaAgentNpmGlobalBinDir('/Users/tester', 'darwin')).toBe('/Users/tester/.hamuna/npm-global/bin');

    expect(getHamunaAgentNpmGlobalPrefix('C:\\Users\\tester', 'win32')).toMatch(/C:[/\\]Users[/\\]tester[/\\]\.hamuna[/\\]npm-global/);
    expect(getHamunaAgentNpmGlobalBinDir('C:\\Users\\tester', 'win32')).toMatch(/C:[/\\]Users[/\\]tester[/\\]\.hamuna[/\\]npm-global/);
  });

  it('scrubs only npm prefix variables that point at the HamunaAgent prefix', () => {
    const prefix = '/Users/tester/.hamuna/npm-global';
    const env: NodeJS.ProcessEnv = {
      npm_config_prefix: `${prefix}/`,
      NPM_CONFIG_PREFIX: '/Users/tester/.npm-global',
      PREFIX: prefix,
    };

    scrubHamunaAgentNpmPrefixEnv(env, prefix, 'darwin');

    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.NPM_CONFIG_PREFIX).toBe('/Users/tester/.npm-global');
    expect(env.PREFIX).toBeUndefined();
  });
});
