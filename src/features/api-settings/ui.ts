import { clearApiConfig, getApiStatus, readApiConfig, saveApiConfig, testApiConnection } from './client';
import { apiOrigin, emptyApiConfig, normalizeApiConfig, normalizeApiEndpoint, validateApiConfig, type ApiConfig } from './types';

/** API secrets are editable only in the trusted extension settings page. */
export function mountApiSettings(root: HTMLElement): () => void {
  root.innerHTML = `<div class="card">
    <div class="section-heading"><h2>API 设置</h2><p>连接兼容 Chat Completions 协议的模型服务。</p></div>
    <form class="settings-form" autocomplete="off">
      <p class="inline-note">开始 AI 作答后，仅当前题目会发往你配置的服务；历史题目和作答不会作为上下文发送，生成后的发送操作由你完成。</p>
      <div class="field"><label for="api-endpoint">API 地址</label><input id="api-endpoint" name="endpoint" type="url" inputmode="url" placeholder="https://服务商域名/v1" spellcheck="false" autocapitalize="none" aria-describedby="endpoint-help endpoint-preview endpoint-error" maxlength="2048" required disabled /><p id="endpoint-help" class="field-help">支持基础或完整地址，自动补全 <code>/chat/completions</code>。</p><p id="endpoint-preview" class="field-help endpoint-preview" hidden></p><p id="endpoint-error" class="field-error" aria-live="polite" hidden></p></div>
      <div class="field"><label for="api-key">API Key</label><div class="input-action"><input id="api-key" name="api-key" type="password" spellcheck="false" autocapitalize="none" autocomplete="off" aria-describedby="key-help" maxlength="4096" required disabled /><button class="secondary reveal-key" type="button" aria-controls="api-key" aria-pressed="false" disabled>显示</button></div><p id="key-help" class="field-help">密钥仅保存在本机，学习通网页无法读取。</p></div>
      <div class="field"><label for="api-model">模型名称</label><input id="api-model" name="model" type="text" placeholder="填写服务商的准确模型名称" spellcheck="false" autocapitalize="none" aria-describedby="model-help" maxlength="200" required disabled /><p id="model-help" class="field-help">填写服务商提供的模型 ID。</p></div>
      <details class="advanced-settings"><summary>高级选项与数据说明</summary><label class="checkbox-row" for="api-stream"><input id="api-stream" type="checkbox" checked disabled /><span>使用流式响应</span></label><p class="field-help">默认开启；完整生成并校验后，一次填入回答。</p><p class="field-help">地址末尾误带的标点会自动移除，完整端点不会重复补全。保存时仅申请所填域名权限。</p></details>
      <div class="api-actions">
        <p id="api-saved-status" class="saved-status" aria-live="polite">正在读取 API 设置…</p>
        <div class="button-row"><button class="primary save-api" type="submit" disabled>保存配置</button><button class="secondary test-api" type="button" aria-describedby="api-saved-status api-test-help" disabled>测试连接</button><button class="text-button clear-api" type="button" disabled>清除配置</button></div>
        <p id="api-test-help" class="field-help">保存不调用模型；测试会发送一次简短请求。</p>
        <div class="feedback" role="status" aria-live="polite" aria-atomic="true" hidden></div>
        <button class="secondary retry-button" type="button" hidden>重新读取设置</button>
      </div>
    </form></div>`;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const endpoint = root.querySelector<HTMLInputElement>('#api-endpoint')!;
  const endpointPreview = root.querySelector<HTMLElement>('#endpoint-preview')!;
  const endpointError = root.querySelector<HTMLElement>('#endpoint-error')!;
  const key = root.querySelector<HTMLInputElement>('#api-key')!;
  const model = root.querySelector<HTMLInputElement>('#api-model')!;
  const stream = root.querySelector<HTMLInputElement>('#api-stream')!;
  const save = root.querySelector<HTMLButtonElement>('.save-api')!;
  const test = root.querySelector<HTMLButtonElement>('.test-api')!;
  const clear = root.querySelector<HTMLButtonElement>('.clear-api')!;
  const reveal = root.querySelector<HTMLButtonElement>('.reveal-key')!;
  const status = root.querySelector<HTMLElement>('.saved-status')!;
  const feedback = root.querySelector<HTMLElement>('.feedback')!;
  const retry = root.querySelector<HTMLButtonElement>('.retry-button')!;
  let saved = emptyApiConfig();
  let loaded = false;
  let busy: 'load' | 'save' | 'test' | 'clear' | undefined;
  let authorized = false;
  let disposed = false;

  function showEndpointError(message = ''): void {
    endpointError.textContent = message;
    endpointError.hidden = !message;
    if (message) endpoint.setAttribute('aria-invalid', 'true');
    else endpoint.removeAttribute('aria-invalid');
  }

  function inspectEndpoint(reportError = false): boolean {
    const normalized = normalizeApiEndpoint(endpoint.value);
    endpointPreview.hidden = true;
    if (!normalized) {
      showEndpointError(reportError ? '请填写服务商的 API 基础地址或完整地址。' : '');
      return false;
    }
    try {
      apiOrigin(normalized);
      endpointPreview.textContent = `实际请求地址：${normalized}`;
      endpointPreview.hidden = false;
      showEndpointError();
      return true;
    } catch (error) {
      if (reportError) showEndpointError(errorText(error, 'API 地址格式不正确。'));
      return false;
    }
  }

  function values(): ApiConfig {
    return normalizeApiConfig({ version: 1, endpoint: endpoint.value, apiKey: key.value, model: model.value, stream: stream.checked });
  }

  function dirty(): boolean {
    const current = values();
    return current.endpoint !== saved.endpoint || current.apiKey !== saved.apiKey || current.model !== saved.model || current.stream !== saved.stream;
  }

  function populated(): boolean { return Boolean(saved.endpoint && saved.apiKey && saved.model); }

  function tell(message: string, error = false): void {
    if (disposed) return;
    feedback.textContent = message;
    feedback.dataset.kind = error ? 'error' : 'success';
    feedback.hidden = false;
  }

  function errorText(error: unknown, fallback: string): string {
    if (!(error instanceof Error) || !error.message) return fallback;
    let text = error.message;
    for (const secret of [key.value.trim(), saved.apiKey]) if (secret) text = text.split(secret).join('***');
    return text.length <= 500 ? text : fallback;
  }

  function render(): void {
    if (disposed) return;
    inspectEndpoint();
    for (const input of [endpoint, key, model, stream]) input.disabled = !loaded || Boolean(busy);
    save.disabled = !loaded || Boolean(busy);
    test.disabled = !loaded || Boolean(busy) || !populated() || !authorized || dirty();
    clear.disabled = !loaded || Boolean(busy) || !populated();
    reveal.disabled = !loaded || Boolean(busy);
    retry.disabled = Boolean(busy);
    save.textContent = busy === 'save' ? '正在保存…' : '保存配置';
    test.textContent = busy === 'test' ? '正在连接…' : '测试连接';
    clear.textContent = busy === 'clear' ? '正在清除…' : '清除配置';
    form.setAttribute('aria-busy', String(Boolean(busy)));
    if (busy === 'load') status.textContent = '正在读取 API 设置…';
    else if (!loaded) status.textContent = '设置尚未读取，请重试。';
    else if (dirty()) status.textContent = '配置已更改，请保存后重新测试。';
    else if (!populated()) status.textContent = '尚未配置 API，请填写并保存。';
    else status.textContent = authorized ? '配置已保存在本机。' : '域名尚未授权，请重新保存以授权。';
  }

  function apply(config: ApiConfig): void {
    endpoint.value = config.endpoint;
    key.value = config.apiKey;
    model.value = config.model;
    stream.checked = config.stream;
    key.type = 'password';
    reveal.textContent = '显示';
    reveal.setAttribute('aria-pressed', 'false');
    showEndpointError();
  }

  async function load(): Promise<void> {
    if (busy || disposed) return;
    busy = 'load';
    render();
    try {
      const [config, apiStatus] = await Promise.all([readApiConfig(), getApiStatus()]);
      if (disposed) return;
      saved = config;
      authorized = apiStatus.authorized;
      loaded = true;
      apply(config);
      feedback.hidden = true;
      retry.hidden = true;
    } catch {
      retry.hidden = false;
      tell('API 设置读取失败，请重新读取；已有配置未被修改。', true);
    } finally { busy = undefined; render(); }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!loaded || busy || disposed) return;
    if (!inspectEndpoint(true)) { endpoint.focus(); return; }
    const config = values();
    let grant: Promise<boolean>;
    try {
      validateApiConfig(config);
      // Request directly in the user gesture, before any asynchronous work.
      grant = chrome.permissions.request({ origins: [apiOrigin(config.endpoint)] });
    } catch (error) {
      tell(errorText(error, '接口配置无效，请检查填写内容。'), true);
      return;
    }
    busy = 'save';
    render();
    void (async () => {
      try {
        if (!await grant) { tell('未授予接口域名访问权限，配置未保存；原配置仍然保留。', true); return; }
        await saveApiConfig(config);
        saved = config;
        authorized = true;
        apply(config);
        tell('配置已保存，可测试连接。');
      } catch (error) { tell(errorText(error, '保存失败，原配置仍然保留，请重试。'), true); }
      finally { busy = undefined; render(); }
    })();
  });

  test.addEventListener('click', () => {
    if (test.disabled || disposed) return;
    busy = 'test';
    render();
    tell('正在测试连接…');
    void (async () => {
      try {
        const result = await testApiConnection();
        tell(`${result.message}（${Math.round(result.latencyMs)} ms）`);
      } catch (error) { tell(errorText(error, '连接失败，请检查接口地址、密钥与模型名称。'), true); }
      finally { busy = undefined; render(); }
    })();
  });

  clear.addEventListener('click', () => {
    if (clear.disabled || disposed) return;
    busy = 'clear';
    render();
    void (async () => {
      try {
        await clearApiConfig();
        saved = emptyApiConfig();
        authorized = false;
        apply(saved);
        tell('API 配置已清除。功能开关与悬浮框偏好已保留。');
      } catch { tell('清除失败，原配置仍然保留。', true); }
      finally { busy = undefined; render(); }
    })();
  });
  reveal.addEventListener('click', () => {
    const visible = key.type === 'password';
    key.type = visible ? 'text' : 'password';
    reveal.textContent = visible ? '隐藏' : '显示';
    reveal.setAttribute('aria-pressed', String(visible));
  });
  endpoint.addEventListener('blur', () => {
    if (!endpoint.value || !inspectEndpoint(true)) return;
    endpoint.value = normalizeApiEndpoint(endpoint.value);
    render();
  });
  form.addEventListener('input', (event) => {
    if (event.target === endpoint) showEndpointError();
    feedback.hidden = true;
    feedback.textContent = '';
    render();
  });
  retry.addEventListener('click', () => void load());
  void load();
  return () => { disposed = true; key.value = ''; saved = emptyApiConfig(); };
}
