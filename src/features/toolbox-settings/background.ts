import { broadcastPublic, privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { FEATURES, isFeatureId } from '../catalog';
import { normalizeSettings, SETTINGS_KEY, type Settings } from '../../shared/settings';

export const SETTINGS_READ = 'toolbox:settings:read';
export const SETTINGS_WRITE = 'toolbox:settings:write';
export const SETTINGS_CHANGED = 'toolbox:settings:changed';
let writes = Promise.resolve();

export async function readStoredSettings(): Promise<Settings> {
  await privateStorageReady;
  const record = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(record[SETTINGS_KEY]);
}

export const settingsRoutes: BackgroundRoutes = {
  [SETTINGS_READ]: { access: 'public', handle: async () => readStoredSettings() },
  [SETTINGS_WRITE]: { access: 'public', handle: async (message) => {
    const input = message.settings;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的功能设置。');
    const value = input as Settings;
    if (value.version !== 1 || typeof value.enabled !== 'boolean' || !value.features
        || Object.entries(value.features).some(([key, enabled]) => !isFeatureId(key) || typeof enabled !== 'boolean')
        || FEATURES.some((feature) => typeof value.features[feature.id] !== 'boolean')) throw new Error('无效的功能设置。');
    const next = normalizeSettings(value);
    const task = writes.then(async () => {
      await privateStorageReady;
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    });
    writes = task.catch(() => undefined);
    await task;
    return next;
  } },
};

export function subscribeStoredSettings(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    void broadcastPublic({ type: SETTINGS_CHANGED, settings: normalizeSettings(changes[SETTINGS_KEY].newValue) });
  });
}
