import { requestExtension } from '../../core/extension-rpc';
import type { StudyNotificationSettings } from './notifications';

export const readNotificationSettings = (): Promise<StudyNotificationSettings> => requestExtension('toolbox:study:notifications:read');
export const writeNotificationSettings = (enabled: boolean): Promise<StudyNotificationSettings> => requestExtension('toolbox:study:notifications:write', { enabled });
export function subscribeNotificationSettings(listener: (settings: StudyNotificationSettings) => void): () => void {
  if (!globalThis.chrome?.runtime?.onMessage) return () => {};
  const receive = (message: { type?: string; settings?: StudyNotificationSettings }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'toolbox:study:notification-settings:changed'
      && typeof message.settings?.enabled === 'boolean' && typeof message.settings.granted === 'boolean') listener(message.settings);
  };
  chrome.runtime.onMessage.addListener(receive);
  return () => chrome.runtime.onMessage.removeListener(receive);
}
