import { broadcastPublic, privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { readApiStatus } from '../api-settings/background';
import { readQuestionBankStatus } from '../question-bank/background';
import { readStoredSettings } from '../toolbox-settings/background';
import { isFeatureEnabled } from '../toolbox-settings/types';
import { ANSWER_PREFERENCES_KEY, type AnswerSourceMode, type AnswerSourcesStatus } from './types';

const isSource = (value: unknown): value is AnswerSourceMode => value === 'ai' || value === 'bank' || value === 'prefer-bank';

async function readSourceSelection(): Promise<AnswerSourceMode | null> {
  await privateStorageReady;
  const record = await chrome.storage.local.get(ANSWER_PREFERENCES_KEY);
  const value: unknown = record[ANSWER_PREFERENCES_KEY];
  if (!value || typeof value !== 'object') return null;
  const preference = value as { version?: unknown; source?: unknown };
  return preference.version === 1 && isSource(preference.source) ? preference.source : null;
}

/** Only the user's selected mode and public booleans leave the background; no provider is contacted. */
export async function readAnswerSourcesStatus(): Promise<AnswerSourcesStatus> {
  const [bank, ai, settings, selection] = await Promise.all([readQuestionBankStatus(), readApiStatus(), readStoredSettings(), readSourceSelection()]);
  return {
    selection,
    bank: { configured: bank.configured, authorized: bank.authorized },
    ai: { configured: ai.configured, authorized: ai.authorized, enabled: isFeatureEnabled(settings, 'ai-answer') },
  };
}

export const answerSourceRoutes: BackgroundRoutes = {
  'toolbox:question-answer:sources': { access: 'public', platforms: ['chaoxing'], handle: async () => {
    try { return await readAnswerSourcesStatus(); }
    catch { throw new Error('无法读取答题来源配置，请重新检查；若仍失败，请重新加载扩展并刷新页面。'); }
  } },
  'toolbox:question-answer:select-source': { access: 'top-page', platforms: ['chaoxing'], handle: async message => {
    if (!isSource(message.source)) throw new Error('请选择有效的答题来源。');
    await privateStorageReady;
    await chrome.storage.local.set({ [ANSWER_PREFERENCES_KEY]: { version: 1, source: message.source } });
  } },
};

export function subscribeStoredAnswerSource(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ANSWER_PREFERENCES_KEY]) {
      void broadcastPublic({ type: 'toolbox:question-answer:source-changed' }, ['chaoxing']);
    }
  });
}
