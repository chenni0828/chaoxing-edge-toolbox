import { broadcastPublic, privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { requestChatCompletion } from './model-client';
import { API_SETTINGS_KEY, apiOrigin, emptyApiConfig, normalizeApiConfig, validateApiConfig, type ApiConfig, type ApiStatus } from './types';

export async function readStoredApiConfig(): Promise<ApiConfig> {
  await privateStorageReady;
  const record = await chrome.storage.local.get(API_SETTINGS_KEY);
  return normalizeApiConfig(record[API_SETTINGS_KEY]);
}

export async function requireApiConfig(): Promise<ApiConfig> {
  const config = await readStoredApiConfig();
  validateApiConfig(config);
  const granted = await chrome.permissions.contains({ origins: [apiOrigin(config.endpoint)] });
  if (!granted) throw new Error('尚未授权 API 域名，请前往 API 设置重新保存并授权。');
  return config;
}

export async function readApiStatus(): Promise<ApiStatus> {
  const config = await readStoredApiConfig();
  try { validateApiConfig(config); } catch {
    return { configured: false, authorized: false, model: '', message: '尚未配置 API，请填写完整接口地址、Key 和模型。' };
  }
  const authorized = await chrome.permissions.contains({ origins: [apiOrigin(config.endpoint)] });
  return {
    configured: true,
    authorized,
    model: config.model,
    message: authorized ? 'API 已配置，连接状态可在设置页手动检查。' : 'API 域名尚未授权，请前往设置重新保存并授权。',
  };
}

let testing = false;
export const apiSettingsRoutes: BackgroundRoutes = {
  'toolbox:api:status': { access: 'public', platforms: ['chaoxing'], handle: async () => readApiStatus() },
  'toolbox:api:read': { access: 'options', handle: async () => readStoredApiConfig() },
  'toolbox:api:save': { access: 'options', handle: async (message) => {
    if (!message.config || typeof message.config !== 'object') throw new Error('无效的 API 设置。');
    const config = normalizeApiConfig(message.config);
    validateApiConfig(config);
    if (!await chrome.permissions.contains({ origins: [apiOrigin(config.endpoint)] })) throw new Error('请先授权填写的 API 域名。');
    await privateStorageReady;
    const previous = await readStoredApiConfig();
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: config });
    try {
      if (previous.endpoint && apiOrigin(previous.endpoint) !== apiOrigin(config.endpoint)) {
        await chrome.permissions.remove({ origins: [apiOrigin(previous.endpoint)] });
      }
    } catch { /* Malformed old records or required site permissions do not invalidate the saved config. */ }
  } },
  'toolbox:api:clear': { access: 'options', handle: async () => {
    await privateStorageReady;
    const previous = await readStoredApiConfig();
    await chrome.storage.local.set({ [API_SETTINGS_KEY]: emptyApiConfig() });
    if (previous.endpoint) { try { await chrome.permissions.remove({ origins: [apiOrigin(previous.endpoint)] }); } catch { /* The stored key was still cleared. */ } }
  } },
  'toolbox:api:test': { access: 'options', handle: async () => {
    if (testing) throw new Error('正在检查连接，请稍候。');
    testing = true;
    const started = Date.now();
    try {
      const config = await requireApiConfig();
      const abort = new AbortController();
      // Active-task extension API calls keep this explicit short check alive.
      const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => undefined); }, 15000);
      try {
        await requestChatCompletion(config, [
          { role: 'system', content: '你正在进行 API 连通性检查，请简短回答。' },
          { role: 'user', content: '请只回复：连接成功。' },
        ], abort.signal);
        return { message: '连接成功，模型已返回正文。', latencyMs: Date.now() - started };
      } finally { clearInterval(keepAlive); }
    } finally { testing = false; }
  } },
};

export function subscribeStoredApi(): void {
  const changed = () => { void broadcastPublic({ type: 'toolbox:api:changed' }, ['chaoxing']); };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[API_SETTINGS_KEY]) changed();
  });
  chrome.permissions.onRemoved.addListener(changed);
  chrome.permissions.onAdded.addListener(changed);
}
