import type { AiAnswerController, AiAnswerState } from '../types';
import type { ApiStatus } from '../../api-settings/types';
import type { Settings } from '../../../shared/settings';

export interface AiAnswerViewDependencies {
  ai: AiAnswerController;
  supported: boolean;
  saveSettings(update: (current: Settings) => Settings): Promise<void>;
  getApiStatus(): Promise<ApiStatus>;
  openSettings(section: 'api' | 'features'): Promise<void>;
}

export interface AiAnswerView {
  element: HTMLElement;
  update(settings: Settings | undefined, saving: boolean): void;
  refreshApiStatus(): void;
  dispose(): void;
}

const phaseLabels: Record<AiAnswerState['phase'], string> = {
  paused: '已暂停', waiting: '等待题目', 'needs-config': '需要配置 API', blocked: '等待确认',
  generating: '正在生成', filled: '已填入', complete: '练习已结束', unsupported: '暂不支持', error: '需要处理',
};

/** Presentation only: the controller owns cancellation, deduplication and editor checks. */
export function createAiAnswerView(dependencies: AiAnswerViewDependencies): AiAnswerView {
  const listeners = new AbortController();
  const { signal } = listeners;
  const root = document.createElement('section');
  root.className = 'feature-view ai-answer-view';
  root.setAttribute('aria-label', 'AI 作答');
  root.innerHTML = `
    <div class="section-heading"><div><h3 class="section-title">AI 作答</h3><p class="description">逐题独立生成简答题答案，完整生成后填入。</p></div><span class="phase-badge"></span></div>
    <div class="empty ai-availability" hidden><p></p><button type="button" class="button" data-action="enable" hidden>启用 AI 作答</button></div>
    <div class="api-status"><span></span><button type="button" class="text-button" data-action="api">去配置 API</button></div>
    <p class="ai-message" role="status" aria-live="polite" aria-atomic="true"></p>
    <div class="ai-question"><p class="editor-label">当前题目 · 简答题</p><p class="question-text"></p><p class="question-meta"></p></div>
    <div class="ai-actions"><button class="button primary" type="button" data-action="start">开始自动填入</button><button class="button" type="button" data-action="stop" hidden>暂停</button><button class="button subtle" type="button" data-action="replace" hidden>仍生成并替换</button><button class="button" type="button" data-action="retry" hidden>重试本题</button></div>
    <div class="answer-preview" hidden><label class="editor-label" for="cx-ai-answer">生成回答 · 纯文本预览</label><textarea class="editor answer-editor" id="cx-ai-answer" aria-describedby="cx-ai-boundary" readonly></textarea></div>
    <p class="editor-hint ai-boundary" id="cx-ai-boundary">只填入答案。发送答案和进入下一题由你操作；刷新页面后保持暂停。</p>
  `;
  function element<T extends HTMLElement>(selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Missing AI UI element: ${selector}`);
    return found;
  }
  const phase = element<HTMLElement>('.phase-badge');
  const availability = element<HTMLElement>('.ai-availability');
  const availabilityText = element<HTMLElement>('.ai-availability p');
  const enableButton = element<HTMLButtonElement>('[data-action="enable"]');
  const apiLine = element<HTMLElement>('.api-status');
  const apiText = element<HTMLElement>('.api-status span');
  const apiButton = element<HTMLButtonElement>('[data-action="api"]');
  const message = element<HTMLElement>('.ai-message');
  const question = element<HTMLElement>('.ai-question');
  const questionText = element<HTMLElement>('.question-text');
  const questionMeta = element<HTMLElement>('.question-meta');
  const start = element<HTMLButtonElement>('[data-action="start"]');
  const stop = element<HTMLButtonElement>('[data-action="stop"]');
  const replace = element<HTMLButtonElement>('[data-action="replace"]');
  const retry = element<HTMLButtonElement>('[data-action="retry"]');
  const preview = element<HTMLElement>('.answer-preview');
  const answer = element<HTMLTextAreaElement>('.answer-editor');
  let settings: Settings | undefined;
  let saving = false;
  let state = dependencies.ai.getState();
  let api: ApiStatus | undefined;
  let apiError = '';
  let localError = '';
  let disposed = false;
  let refresh = 0;

  function render(): void {
    if (disposed) return;
    const enabled = Boolean(settings?.enabled && settings.features['ai-answer']);
    phase.textContent = dependencies.supported ? phaseLabels[state.phase] : '暂不支持';
    phase.dataset.phase = dependencies.supported ? state.phase : 'unsupported';
    availability.hidden = dependencies.supported && enabled;
    availabilityText.textContent = !dependencies.supported ? 'AI 作答目前仅支持学习通“思维阶梯”页面的简答题。'
      : !settings ? '正在读取工具箱设置…' : !settings.enabled ? '工具箱已暂停。先打开上方“启用工具箱”。' : 'AI 作答已关闭，启用后可手动开始。';
    enableButton.hidden = !dependencies.supported || !settings?.enabled || enabled;
    enableButton.disabled = saving;
    apiLine.hidden = !dependencies.supported;
    apiLine.dataset.state = apiError ? 'error' : api?.configured && api.authorized ? 'ready' : 'pending';
    apiText.textContent = apiError || (api ? api.configured && api.authorized ? `API 已配置 · ${api.model}` : api.message || '尚未配置 API' : '正在读取 API 状态…');
    apiButton.textContent = api?.configured && api.authorized ? 'API 设置' : '去配置 API';
    message.textContent = localError || (dependencies.supported ? state.message : '打开思维阶梯答题页后，再开始自动填入。');
    message.dataset.kind = localError || state.phase === 'error' ? 'error' : 'info';
    question.hidden = !dependencies.supported || !state.question;
    questionText.textContent = state.question?.stem ?? '';
    questionMeta.textContent = state.question?.knowledgePoints.length ? `知识点：${state.question.knowledgePoints.join('、')}` : '';
    questionMeta.hidden = !questionMeta.textContent;
    start.hidden = state.running;
    start.disabled = !dependencies.supported || !enabled || saving || state.phase === 'complete';
    start.textContent = api && (!api.configured || !api.authorized) ? '先配置 API'
      : state.phase === 'needs-config' ? '检查配置并开始' : '开始自动填入';
    stop.hidden = !state.running;
    replace.hidden = !state.canConfirmReplace || !enabled || !dependencies.supported;
    replace.disabled = saving;
    retry.hidden = state.phase !== 'error' || !dependencies.supported || !enabled;
    retry.disabled = saving;
    preview.hidden = !state.answer;
    if (answer.value !== state.answer) answer.value = state.answer;
    preview.setAttribute('aria-busy', String(state.phase === 'generating'));
  }
  async function openApi(): Promise<void> {
    try { await dependencies.openSettings('api'); }
    catch { localError = '无法打开 API 设置，请从扩展菜单进入设置。'; render(); }
  }
  start.addEventListener('click', () => {
    if (!dependencies.supported) return;
    localError = '';
    if (api && (!api.configured || !api.authorized)) {
      void openApi();
      return;
    }
    dependencies.ai.start();
  }, { signal });
  stop.addEventListener('click', () => dependencies.ai.stop(), { signal });
  replace.addEventListener('click', () => {
    if (dependencies.supported) { localError = ''; dependencies.ai.confirmReplace(); }
  }, { signal });
  retry.addEventListener('click', () => {
    if (dependencies.supported) { localError = ''; dependencies.ai.retry(); }
  }, { signal });
  apiButton.addEventListener('click', () => { void openApi(); }, { signal });
  enableButton.addEventListener('click', () => {
    void dependencies.saveSettings((current) => ({ ...current, features: { ...current.features, 'ai-answer': true } }))
      .catch(() => { localError = '设置保存失败，请重试。'; render(); });
  }, { signal });
  const unsubscribe = dependencies.ai.subscribe((value) => { state = value; localError = ''; render(); });
  function refreshApiStatus(): void {
    if (!dependencies.supported || disposed) return;
    const token = ++refresh;
    void dependencies.getApiStatus().then((value) => {
      if (disposed || token !== refresh) return;
      api = value;
      apiError = '';
      render();
    }).catch(() => {
      if (disposed || token !== refresh) return;
      apiError = '无法读取 API 状态，请进入设置检查。';
      render();
    });
  }
  render();
  refreshApiStatus();
  return {
    element: root,
    update(value, pending) { settings = value; saving = pending; render(); },
    refreshApiStatus,
    dispose() { disposed = true; refresh++; unsubscribe(); listeners.abort(); answer.value = ''; root.remove(); },
  };
}
