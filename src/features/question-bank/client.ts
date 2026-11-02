import { requestExtension } from '../../core/extension-rpc';
import type { QuestionBankConfig, QuestionBankStatus } from './types';

export const readQuestionBankConfig = (): Promise<QuestionBankConfig> => requestExtension('toolbox:question-bank:read');
export const saveQuestionBankConfig = (config: QuestionBankConfig): Promise<void> => requestExtension('toolbox:question-bank:save', { config });
export const clearQuestionBankConfig = (): Promise<void> => requestExtension('toolbox:question-bank:clear');
export const getQuestionBankStatus = (): Promise<QuestionBankStatus> => requestExtension('toolbox:question-bank:status');

export function subscribeQuestionBankStatus(listener: () => void): () => void {
  const onMessage = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'toolbox:question-bank:changed') listener();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return () => chrome.runtime.onMessage.removeListener(onMessage);
}
