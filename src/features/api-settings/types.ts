export const API_SETTINGS_KEY = 'toolbox.api.v1';
export const AI_GENERATION_PORT = 'toolbox:ai-generation:v1';

export interface ApiConfig {
  version: 1;
  endpoint: string;
  apiKey: string;
  model: string;
  stream: boolean;
}

export interface ApiStatus {
  configured: boolean;
  authorized: boolean;
  model: string;
  message: string;
}

export function emptyApiConfig(): ApiConfig {
  return { version: 1, endpoint: '', apiKey: '', model: '', stream: true };
}

/** Accept a base URL or a complete endpoint; never add the suffix twice. */
export function normalizeApiEndpoint(value: string): string {
  const endpoint = value.trim().replace(/[，。；、,;]+$/u, '');
  if (!endpoint) return '';
  try {
    const url = new URL(endpoint);
    // Leave invalid settings intact so validation reports them instead of fixing them silently.
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return endpoint;
    // URL.pathname encodes pasted Chinese punctuation; strip only terminal punctuation.
    const path = url.pathname.replace(/\/+$/, '')
      .replace(/(?:%EF%BC%8C|%E3%80%82|%EF%BC%9B|%E3%80%81|%2C|%3B)+$/i, '');
    url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
    return url.href;
  } catch {
    return endpoint;
  }
}

export function normalizeApiConfig(value: unknown): ApiConfig {
  const result = emptyApiConfig();
  if (!value || typeof value !== 'object') return result;
  const input = value as Partial<ApiConfig>;
  for (const key of ['endpoint', 'apiKey', 'model'] as const) {
    if (typeof input[key] === 'string') result[key] = input[key].trim();
  }
  result.endpoint = normalizeApiEndpoint(result.endpoint);
  if (typeof input.stream === 'boolean') result.stream = input.stream;
  return result;
}

export function apiOrigin(endpoint: string): string {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new Error('API 地址无效，请填写以 https:// 开头的基础地址或完整 Chat Completions 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error('API 地址须使用 HTTPS，且不能包含查询参数、账号信息或 # 片段。');
  }
  // Browser host permissions are scoped to scheme/host, not an endpoint port.
  return `${url.protocol}//${url.hostname}/*`;
}

export function validateApiConfig(config: ApiConfig): void {
  if (!config.endpoint || !config.apiKey || !config.model) throw new Error('请填写完整接口地址、API Key 和模型名称。');
  apiOrigin(config.endpoint);
  if (config.endpoint.length > 2048 || config.apiKey.length > 4096 || config.model.length > 200) throw new Error('API 设置字段过长，请检查填写内容。');
  if (/[\r\n]/.test(config.apiKey) || /[\r\n]/.test(config.model)) throw new Error('API Key 和模型名称不能包含换行。');
  if (/[^\x21-\x7e]/.test(config.apiKey) || /^['"]|['"]$/.test(config.apiKey)) throw new Error('API Key 只填写密钥本身，不要包含 Bearer、引号、空格或其他请求头内容。');
}
