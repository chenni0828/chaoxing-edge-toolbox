import { requestExtension } from '../../core/extension-rpc';
import type { AnswerPacingPreferences } from './types';

export const readAnswerPacing = (): Promise<AnswerPacingPreferences> => requestExtension('toolbox:answer-pacing:read');
export const saveAnswerPacing = (preferences: AnswerPacingPreferences): Promise<void> => requestExtension('toolbox:answer-pacing:save', { preferences });
export function subscribeAnswerPacing(listener: () => void): () => void {
  const callback = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'toolbox:answer-pacing:changed') listener();
  };
  chrome.runtime.onMessage.addListener(callback);
  return () => chrome.runtime.onMessage.removeListener(callback);
}
