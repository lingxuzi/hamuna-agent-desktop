import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  SOCIAL_PLATFORMS,
  withSocialAccount,
  type SocialAccount,
  type SocialPlatformId,
} from '../../../../shared/socialPlatforms';
import { atomicModifyConfig } from '@/config/configService';
import { useConfigData } from '@/config/useConfigData';
import { useToast } from '@/components/Toast';

/**
 * 发布授权：每个平台一个「允许自动发布」开关。
 *
 * 这里只管**授权**，不管账号。账号（哪个号、叫什么、登录没登录）是工作区级的，
 * 搬到了运营工作台的账号视图 —— 新建一个工作区就是一套新的账号管理体系，
 * 两个工作区的登录态互不可见。
 *
 * 授权留在全局是有意的：它的含义是「这台机器上允不允许这个平台被无人值守地
 * 发布」，与哪个工作区的号无关。反过来把它也做成工作区级，用户在 A 工作区
 * 授权过、在 B 工作区发内容时又要重新授权一遍 —— 那不是隔离，是添乱。
 */
export function PublishAuthorizationSection() {
  const { t } = useTranslation('settings');
  const { config } = useConfigData();
  const toast = useToast();

  const accounts = useMemo(() => config.socialAccounts ?? {}, [config.socialAccounts]);

  const writeAutoPublish = useCallback(
    async (platformId: SocialPlatformId, autoPublish: boolean) => {
      try {
        // MUST be atomicModifyConfig: `updateConfig({ socialAccounts })` shallow-
        // merges at the ROOT, so writing one platform drops every other platform.
        await atomicModifyConfig((latest) => ({
          ...latest,
          socialAccounts: withSocialAccount(latest.socialAccounts, platformId, { autoPublish }),
        }));
      } catch (err) {
        toast.error(t('accounts.saveFailed', { message: String(err) }));
      }
    },
    [t, toast],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-8 py-8">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">{t('accounts.title')}</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{t('accounts.description')}</p>
      </div>

      <div className="space-y-3">
        {SOCIAL_PLATFORMS.map((platform) => {
          const account = accounts[platform.id] as SocialAccount | undefined;
          const granted = account?.autoPublish === true;
          return (
            <div
              key={platform.id}
              className="flex items-center gap-4 rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper-elevated)] px-5 py-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--paper-inset)] text-xs font-medium text-[var(--ink-secondary)]">
                {platform.badge}
              </div>

              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-[var(--ink)]">
                  {t(`accounts.platform.${platform.id}`)}
                </span>
                {/* 开关和它的说明共用同一条 20px 行盒，这一对读起来是一个控件。 */}
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={granted}
                    aria-label={t('accounts.autoPublish')}
                    title={t('accounts.autoPublishHint')}
                    onClick={() => {
                      void writeAutoPublish(platform.id, !granted);
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      granted ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-[var(--toggle-thumb)] shadow-sm ring-0 transition-transform ${
                        granted ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <span className="text-xs leading-5 text-[var(--ink-muted)]">
                    {t('accounts.autoPublish')}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
