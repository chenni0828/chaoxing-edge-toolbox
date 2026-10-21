import { requestExtension } from '../../core/extension-rpc';
import { copyUiSnapshot, isUiSnapshot, type UiSnapshot, type UiUpdate, type UiWriteResult } from './preferences';

export const readUiPreferences = (): Promise<UiSnapshot> => requestExtension('toolbox:ui:read');
export const writeUiPreferences = (update: UiUpdate): Promise<UiWriteResult> => requestExtension(
  update.reset === 'position' ? 'toolbox:ui:reset-position' : 'toolbox:ui:write', { update },
);
export const resetUiPreferences = (update: UiUpdate & { reset: 'position' | 'all' }): Promise<UiWriteResult> => requestExtension('toolbox:ui:reset', { update });

export function subscribeUiPreferences(listener: (snapshot: UiSnapshot) => void): () => void {
  const onMessage = (message: { type?: string; snapshot?: unknown }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'toolbox:ui:changed' && isUiSnapshot(message.snapshot)) listener(copyUiSnapshot(message.snapshot));
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return () => chrome.runtime.onMessage.removeListener(onMessage);
}
