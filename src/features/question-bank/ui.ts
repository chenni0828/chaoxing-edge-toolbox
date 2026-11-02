import { clearQuestionBankConfig, getQuestionBankStatus, readQuestionBankConfig, saveQuestionBankConfig } from './client';
import { QUESTION_BANK_ORIGIN, emptyQuestionBankConfig } from './types';
import { parseQuestionBankConfigInput } from './config-import';

/** Private token editing is mounted only on the extension options page. */
export function mountQuestionBankSettings(root: HTMLElement): () => void {
  root.innerHTML = `<div class="card">
    <div class="section-heading"><h2>言溪题库</h2><p>连接言溪题库，为测验、作业和考试提供参考答案。</p></div>
    <form class="settings-form" autocomplete="off">
      <p class="inline-note">言溪题库为可选来源，只配置 AI 也能自动答题。首次需在答题或章节学习面板选择来源；选择“言溪优先，AI 补充”后，先查询言溪，未命中再使用 AI；请求异常会暂停。</p>
      <div class="field"><label for="question-bank-token">题库配置或 Token</label><div class="input-action"><input id="question-bank-token" type="password" spellcheck="false" autocapitalize="none" autocomplete="off" maxlength="65536" placeholder="粘贴官网复制的题库配置，也可直接输入 Token" aria-describedby="question-bank-import-help" required disabled /><button type="button" class="secondary reveal-bank-token" aria-controls="question-bank-token" aria-pressed="false" disabled>显示</button></div><p class="field-help" id="question-bank-import-help">在 <a href="https://tk.enncy.cn/" target="_blank" rel="noopener noreferrer">言溪题库官网</a> 点击“复制题库配置”，将整段内容粘贴到此处，自动提取 Token 后点击保存。也支持直接填写 Token；仅保存在本机，学习通网页无法读取。</p></div>
      <p class="field-help">保存时只申请 tk.enncy.cn 的访问权限，不查询题目。开始答题后将当前题干、选项和所需图片发送给言溪题库。</p>
      <div class="api-actions"><p class="bank-saved-status saved-status" aria-live="polite">正在读取题库设置…</p><div class="button-row"><button type="submit" class="primary save-bank" disabled>保存配置</button><button type="button" class="text-button clear-bank" disabled>清除配置</button></div><div class="feedback" role="status" aria-live="polite" hidden></div><button type="button" class="secondary retry-bank" hidden>重新读取设置</button></div>
    </form>
  </div>`;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const token = root.querySelector<HTMLInputElement>('#question-bank-token')!;
  const reveal = root.querySelector<HTMLButtonElement>('.reveal-bank-token')!;
  const save = root.querySelector<HTMLButtonElement>('.save-bank')!;
  const clear = root.querySelector<HTMLButtonElement>('.clear-bank')!;
  const retry = root.querySelector<HTMLButtonElement>('.retry-bank')!;
  const status = root.querySelector<HTMLElement>('.bank-saved-status')!;
  const feedback = root.querySelector<HTMLElement>('.feedback')!;
  const listeners = new AbortController();
  const { signal } = listeners;
  let saved = emptyQuestionBankConfig();
  let loaded = false;
  let authorized = false;
  let busy: 'load' | 'save' | 'clear' | undefined;
  let disposed = false;

  function tell(message: string, error = false): void {
    if (disposed) return;
    for (const secret of [token.value.trim(), saved.token]) if (secret) message = message.split(secret).join('[已隐藏]');
    feedback.textContent = message.slice(0, 500); feedback.dataset.kind = error ? 'error' : 'success'; feedback.hidden = false;
  }
  function render(): void {
    if (disposed) return;
    token.disabled = reveal.disabled = save.disabled = !loaded || Boolean(busy);
    clear.disabled = !loaded || Boolean(busy) || !saved.token;
    retry.disabled = Boolean(busy);
    save.textContent = busy === 'save' ? '正在保存…' : '保存配置';
    clear.textContent = busy === 'clear' ? '正在清除…' : '清除配置';
    form.setAttribute('aria-busy', String(Boolean(busy)));
    status.textContent = busy === 'load' ? '正在读取题库设置…' : !loaded ? '题库设置尚未读取。'
      : token.value.trim() !== saved.token ? '配置已更改，请保存。' : !saved.token ? '尚未配置言溪题库。'
        : authorized ? '配置已保存在本机。' : '题库域名尚未授权，请重新保存。';
  }
  function apply(): void {
    token.value = saved.token; token.type = 'password'; reveal.textContent = '显示'; reveal.setAttribute('aria-pressed', 'false');
  }
  async function load(): Promise<void> {
    if (busy || disposed) return;
    busy = 'load'; render();
    try {
      const [config, publicStatus] = await Promise.all([readQuestionBankConfig(), getQuestionBankStatus()]);
      if (disposed) return;
      saved = config; authorized = publicStatus.authorized; loaded = true; apply(); retry.hidden = true; feedback.hidden = true;
    } catch { retry.hidden = false; tell('题库设置读取失败，已有配置未修改，请重试。', true); }
    finally { busy = undefined; render(); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!loaded || busy || disposed) return;
    let config: ReturnType<typeof parseQuestionBankConfigInput>;
    let grant: Promise<boolean>;
    try {
      config = parseQuestionBankConfigInput(token.value);
      token.value = config.token; token.type = 'password'; reveal.textContent = '显示'; reveal.setAttribute('aria-pressed', 'false');
      grant = chrome.permissions.request({ origins: [QUESTION_BANK_ORIGIN] });
    } catch (error) { tell(error instanceof Error ? error.message : '题库配置无效。', true); return; }
    busy = 'save'; render();
    void (async () => {
      try {
        if (!await grant) { tell('未获得题库域名权限，已有配置未修改。', true); return; }
        if (disposed) return;
        await saveQuestionBankConfig(config);
        if (disposed) return;
        saved = config; authorized = true; apply(); tell('言溪题库配置已保存。');
      } catch (error) { tell(error instanceof Error ? error.message : '题库配置保存失败。', true); }
      finally { busy = undefined; render(); }
    })();
  }, { signal });
  clear.addEventListener('click', () => {
    if (clear.disabled || disposed) return;
    busy = 'clear'; render();
    void clearQuestionBankConfig().then(() => {
      if (disposed) return;
      saved = emptyQuestionBankConfig(); authorized = false; apply(); tell('言溪题库配置已清除。');
    }).catch(() => tell('清除失败，请重试。', true)).finally(() => { busy = undefined; render(); });
  }, { signal });
  reveal.addEventListener('click', () => {
    const visible = token.type === 'password'; token.type = visible ? 'text' : 'password';
    reveal.textContent = visible ? '隐藏' : '显示'; reveal.setAttribute('aria-pressed', String(visible));
  }, { signal });
  token.addEventListener('input', () => { feedback.hidden = true; feedback.textContent = ''; render(); }, { signal });
  token.addEventListener('paste', event => {
    if (!loaded || busy || disposed) return;
    const input = event.clipboardData?.getData('text/plain');
    if (!input || (!input.trim().startsWith('[') && !input.trim().startsWith('{'))) return;
    event.preventDefault();
    try {
      const config = parseQuestionBankConfigInput(input);
      token.value = config.token; token.type = 'password'; reveal.textContent = '显示'; reveal.setAttribute('aria-pressed', 'false');
      tell('已识别言溪题库配置并提取 Token，请点击“保存配置”。');
    } catch (error) { tell(error instanceof Error ? error.message : '题库配置无法识别，请重新复制。', true); }
    render();
  }, { signal });
  retry.addEventListener('click', () => void load(), { signal });
  void load();
  return () => { disposed = true; listeners.abort(); token.value = ''; saved = emptyQuestionBankConfig(); };
}
