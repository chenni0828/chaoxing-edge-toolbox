import { broadcastPublic, privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { copyUiSnapshot, createUiPreferenceStore, isUiSnapshot, UI_SETTINGS_KEY } from './preferences';

const store = createUiPreferenceStore({
  get: async keys => { await privateStorageReady; return chrome.storage.local.get(keys); },
  set: async values => { await privateStorageReady; await chrome.storage.local.set(values); },
});

export const uiRoutes: BackgroundRoutes = {
  'toolbox:ui:read': { access: 'public', handle: async () => {
    return store.read();
  } },
  'toolbox:ui:write': { access: 'public', handle: async (message) => {
    return store.write(message.update);
  } },
  'toolbox:ui:reset-position': { access: 'public', handle: async (message) => {
    const update = message.update;
    if (!update || typeof update !== 'object' || Array.isArray(update)
        || (update as Record<string, unknown>).reset !== 'position') throw new Error('无效的悬浮框位置复位操作。');
    return store.reset(update);
  } },
  'toolbox:ui:reset': { access: 'options', handle: async (message) => {
    return store.reset(message.update);
  } },
};

export function subscribeStoredUi(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const snapshot: unknown = changes[UI_SETTINGS_KEY]?.newValue;
    if (area === 'local' && isUiSnapshot(snapshot)) {
      void broadcastPublic({ type: 'toolbox:ui:changed', snapshot: copyUiSnapshot(snapshot) });
    }
  });
}
