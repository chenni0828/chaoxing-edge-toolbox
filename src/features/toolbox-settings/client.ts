import { normalizeSettings, type Settings } from './types';
import { requestExtension } from '../../core/extension-rpc';

const SETTINGS_READ = 'toolbox:settings:read';
const SETTINGS_WRITE = 'toolbox:settings:write';
const SETTINGS_CHANGED = 'toolbox:settings:changed';

export async function readSettings(): Promise<Settings> {
  return normalizeSettings(await requestExtension(SETTINGS_READ));
}

/** Only extension-owned UI writes preferences; public page messages never reach this function. */
export async function writeSettings(settings: Settings): Promise<void> {
  await requestExtension(SETTINGS_WRITE, { settings: normalizeSettings(settings) });
}

export function subscribeSettings(listener: (settings: Settings) => void): () => void {
  const onChanged = (message: { type?: string; settings?: unknown }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.type === SETTINGS_CHANGED) listener(normalizeSettings(message.settings));
  };
  chrome.runtime.onMessage.addListener(onChanged);
  return () => chrome.runtime.onMessage.removeListener(onChanged);
}
