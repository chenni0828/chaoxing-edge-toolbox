import { requestExtension } from '../../core/extension-rpc';
import type { UiPreferences } from './preferences';

export const readUiPreferences = (): Promise<UiPreferences> => requestExtension('toolbox:ui:read');
export const writeUiPreferences = (preferences: UiPreferences): Promise<void> => requestExtension('toolbox:ui:write', { preferences });
export const resetUiPreferences = (): Promise<void> => requestExtension('toolbox:ui:reset');

export function subscribeUiPreferences(listener: (preferences: UiPreferences) => void): () => void {
  const onMessage = (message: { type?: string; preferences?: UiPreferences }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'toolbox:ui:changed' && message.preferences) listener(message.preferences);
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return () => chrome.runtime.onMessage.removeListener(onMessage);
}
