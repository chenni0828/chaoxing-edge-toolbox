import { broadcastPublic, privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { defaultUiPreferences, normalizeUiPreferences, UI_SETTINGS_KEY } from './preferences';

export const uiRoutes: BackgroundRoutes = {
  'toolbox:ui:read': { access: 'public', handle: async () => {
    await privateStorageReady;
    const record = await chrome.storage.local.get(UI_SETTINGS_KEY);
    return normalizeUiPreferences(record[UI_SETTINGS_KEY]);
  } },
  'toolbox:ui:write': { access: 'public', handle: async (message) => {
    if (!message.preferences || typeof message.preferences !== 'object') throw new Error('无效的悬浮框设置。');
    await privateStorageReady;
    await chrome.storage.local.set({ [UI_SETTINGS_KEY]: normalizeUiPreferences(message.preferences) });
  } },
  'toolbox:ui:reset': { access: 'options', handle: async () => {
    await privateStorageReady;
    await chrome.storage.local.set({ [UI_SETTINGS_KEY]: defaultUiPreferences() });
  } },
};

export function subscribeStoredUi(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[UI_SETTINGS_KEY]) {
      void broadcastPublic({ type: 'toolbox:ui:changed', preferences: normalizeUiPreferences(changes[UI_SETTINGS_KEY].newValue) });
    }
  });
}
