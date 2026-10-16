import { formatQuestions, type ExtractedQuestion } from '../extract';
import type { ExtractionResponse } from '../../../shared/messages';
import type { Settings } from '../../../shared/settings';

export interface QuestionExtractViewDependencies {
  getSettings(): Settings | undefined;
  saveSettings(update: (current: Settings) => Settings): Promise<void>;
  extract(): Promise<ExtractionResponse>;
}

export interface QuestionExtractView {
  element: HTMLElement;
  update(settings: Settings | undefined, saving: boolean): void;
  dispose(): void;
}

type QuestionDraft = { question: ExtractedQuestion; text: string };

/** Extraction owns its transient drafts; the toolbox shell owns navigation and positioning. */
export function createQuestionExtractView(dependencies: QuestionExtractViewDependencies): QuestionExtractView {
  const listeners = new AbortController();
  const { signal } = listeners;
  const root = document.createElement('section');
  root.className = 'feature-view';
  root.setAttribute('aria-label', '题目提取');
  root.innerHTML = `
    <div class="section-heading"><div><h3 class="section-title">题目提取</h3><p class="description">提取题干、选项与图片链接，逐题预览并复制。</p></div><button class="button subtle" data-action="extract" type="button">提取题目</button></div>
    <p class="refresh-note" hidden>重新提取会替换当前题目和预览中的编辑内容。</p>
    <div class="empty"><p data-empty-text>点击“提取题目”，选择需要的题目后复制。</p><button class="button" data-action="enable" type="button" hidden>启用题目提取</button></div>
    <div class="results" hidden>
      <p class="summary"></p><nav class="question-list" aria-label="选择题目"></nav>
      <div class="navigation"><button class="button" data-action="previous" type="button">← 上一题</button><span class="counter" aria-live="polite"></span><button class="button" data-action="next" type="button">下一题 →</button></div>
      <label class="editor-label" for="cx-question-markdown">本题预览 · Markdown</label><textarea class="editor" id="cx-question-markdown" spellcheck="false" aria-describedby="cx-extract-hint"></textarea>
      <p class="editor-hint" id="cx-extract-hint">可直接修改；切换题目会保留编辑，复制全部也会采用编辑内容。</p>
      <div class="copy-actions"><button class="button primary" data-action="copy-one" type="button">复制本题</button><button class="button" data-action="copy-all" type="button">复制全部</button></div>
    </div>
    <p class="warnings" hidden></p><p class="message" role="status" aria-live="polite" aria-atomic="true" hidden></p><textarea class="manual-copy" aria-label="手动复制全部题目：按 Ctrl+C" readonly hidden></textarea>
  `;
  function element<T extends HTMLElement>(selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Missing extraction UI element: ${selector}`);
    return found;
  }
  const extractButton = element<HTMLButtonElement>('[data-action="extract"]');
  const enableButton = element<HTMLButtonElement>('[data-action="enable"]');
  const empty = element<HTMLElement>('.empty');
  const emptyText = element<HTMLElement>('[data-empty-text]');
  const results = element<HTMLElement>('.results');
  const summary = element<HTMLElement>('.summary');
  const questionList = element<HTMLElement>('.question-list');
  const counter = element<HTMLElement>('.counter');
  const previous = element<HTMLButtonElement>('[data-action="previous"]');
  const next = element<HTMLButtonElement>('[data-action="next"]');
  const editor = element<HTMLTextAreaElement>('.editor');
  const copyOne = element<HTMLButtonElement>('[data-action="copy-one"]');
  const copyAll = element<HTMLButtonElement>('[data-action="copy-all"]');
  const refreshNote = element<HTMLElement>('.refresh-note');
  const warnings = element<HTMLElement>('.warnings');
  const message = element<HTMLElement>('.message');
  const manualCopy = element<HTMLTextAreaElement>('.manual-copy');
  let settings = dependencies.getSettings();
  let saving = false;
  let drafts: QuestionDraft[] = [];
  let selectedIndex = 0;
  let generation = 0;
  let extracting = false;
  let copying = false;
  let disposed = false;
  let hasExtracted = false;
  let frameCount = 0;
  let extractionWarnings: string[] = [];
  let extractionError = '';

  function enabled(): boolean {
    return Boolean(settings?.enabled && settings.features['question-extract']);
  }
  function announce(text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    if (disposed) return;
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = !text;
  }
  function snippet(text: string): string {
    return text.split('\n').map((line) => line.trim()).find((line) => line && !/^#{1,6}\s/.test(line))
      ?.replace(/^[>*_`\s-]+/, '').slice(0, 100) || '（空白题目）';
  }
  function renderQuestionList(): void {
    const fragment = document.createDocumentFragment();
    drafts.forEach((draft, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'question-item';
      button.dataset.questionIndex = String(index);
      button.setAttribute('aria-current', String(index === selectedIndex));
      const number = document.createElement('span');
      number.className = 'question-number';
      number.textContent = `第 ${draft.question.number} 题`;
      const text = document.createElement('span');
      text.className = 'question-snippet';
      text.textContent = snippet(draft.text);
      button.title = `${number.textContent} · ${text.textContent}`;
      button.append(number, text);
      fragment.append(button);
    });
    questionList.replaceChildren(fragment);
  }
  function renderSelection(): void {
    const draft = drafts[selectedIndex];
    if (editor.value !== (draft?.text ?? '')) editor.value = draft?.text ?? '';
    editor.setAttribute('aria-label', draft ? `第 ${draft.question.number} 题，Markdown 预览，可编辑` : '本题预览');
    counter.textContent = draft ? `${selectedIndex + 1} / ${drafts.length} 题` : '';
    for (const button of questionList.querySelectorAll<HTMLButtonElement>('[data-question-index]')) {
      button.setAttribute('aria-current', String(Number(button.dataset.questionIndex) === selectedIndex));
    }
    previous.disabled = selectedIndex <= 0;
    next.disabled = selectedIndex >= drafts.length - 1;
    copyOne.disabled = copying || !draft?.text.trim() || !enabled();
    copyAll.disabled = copying || !drafts.some((item) => item.text.trim()) || !enabled();
    copyOne.textContent = copying ? '正在复制…' : '复制本题';
    editor.disabled = !enabled();
  }
  function render(): void {
    if (disposed) return;
    const active = enabled();
    extractButton.disabled = !active || extracting || copying || saving;
    extractButton.textContent = extracting ? '提取中…' : hasExtracted ? '重新提取' : '提取题目';
    results.setAttribute('aria-busy', String(extracting));
    refreshNote.hidden = !drafts.length || !active;
    results.hidden = !active || !drafts.length;
    empty.hidden = active && drafts.length > 0;
    if (!settings) emptyText.textContent = '正在读取工具箱设置…';
    else if (!settings.enabled) emptyText.textContent = '工具箱已暂停。打开上方“启用工具箱”即可恢复操作。';
    else if (!active) emptyText.textContent = '题目提取已关闭，启用后即可在当前页面提取。';
    else if (extracting) emptyText.textContent = '正在读取页面题目，请稍候…';
    else if (extractionError) emptyText.textContent = extractionError;
    else if (hasExtracted) emptyText.textContent = '未找到可识别的题目。等待题目加载后重新提取。';
    else emptyText.textContent = '点击“提取题目”，选择需要的题目后复制。';
    enableButton.hidden = !settings?.enabled || active;
    enableButton.disabled = saving;
    summary.textContent = `共 ${drafts.length} 题${frameCount > 1 ? ` · 来自 ${frameCount} 个页面区域` : ''}，选择一题查看。`;
    warnings.hidden = !active || !extractionWarnings.length;
    warnings.textContent = extractionWarnings.join('\n');
    renderSelection();
  }
  function select(index: number): void {
    if (index < 0 || index >= drafts.length || index === selectedIndex) return;
    selectedIndex = index;
    manualCopy.hidden = true;
    announce('');
    renderSelection();
    questionList.querySelector<HTMLButtonElement>(`[data-question-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  async function extract(): Promise<void> {
    if (!enabled() || extracting || copying || saving || disposed) return;
    const token = ++generation;
    extracting = true;
    hasExtracted = true;
    drafts = [];
    selectedIndex = 0;
    extractionWarnings = [];
    extractionError = '';
    manualCopy.hidden = true;
    manualCopy.value = '';
    announce('');
    renderQuestionList();
    render();
    try {
      const response = await dependencies.extract();
      if (disposed || token !== generation) return;
      if (!response.ok) {
        extractionError = response.error;
        announce(response.error, 'error');
      } else {
        drafts = response.questions.map((question) => ({ question, text: formatQuestions([question]) }));
        frameCount = response.frameCount;
        extractionWarnings = response.warnings;
        announce(drafts.length ? `已提取 ${drafts.length} 题。选择题目后可编辑并复制。` : '当前页面没有可识别的题目。', drafts.length ? 'success' : 'info');
      }
    } catch {
      if (disposed || token !== generation) return;
      extractionError = '题目提取失败，请刷新学习通页面后重试。';
      announce(extractionError, 'error');
    } finally {
      if (!disposed && token === generation) {
        extracting = false;
        renderQuestionList();
        render();
      }
    }
  }
  async function copy(all: boolean): Promise<void> {
    if (copying || !enabled() || disposed) return;
    const text = all ? drafts.map((draft) => draft.text).join('\n\n---\n\n') : drafts[selectedIndex]?.text;
    if (!text?.trim()) return;
    const selectionAtStart = selectedIndex;
    copying = true;
    extractButton.disabled = true;
    manualCopy.hidden = true;
    announce('');
    renderSelection();
    try {
      await navigator.clipboard.writeText(text);
      if (!disposed) announce(all ? `已复制全部 ${drafts.length} 题。` : '已复制本题。', 'success');
    } catch {
      if (disposed) return;
      if (all || selectedIndex !== selectionAtStart) {
        manualCopy.value = text;
        manualCopy.setAttribute('aria-label', `手动复制${all ? '全部题目' : '本题内容'}：按 Ctrl+C`);
        manualCopy.hidden = false;
        manualCopy.focus();
        manualCopy.select();
      } else {
        editor.focus();
        editor.select();
      }
      announce(`自动复制未完成，已选中${all ? '全部题目' : '本题内容'}。请按 Ctrl+C 手动复制。`, 'error');
    } finally {
      copying = false;
      // Do not rerender the textarea here: its selection is the clipboard fallback.
      copyOne.disabled = !drafts[selectedIndex]?.text.trim() || !enabled();
      copyAll.disabled = !drafts.some((draft) => draft.text.trim()) || !enabled();
      copyOne.textContent = '复制本题';
      extractButton.disabled = !enabled() || extracting || saving;
    }
  }
  enableButton.addEventListener('click', () => {
    void dependencies.saveSettings((current) => ({ ...current, features: { ...current.features, 'question-extract': true } }))
      .catch(() => announce('设置保存失败，请重试。', 'error'));
  }, { signal });
  extractButton.addEventListener('click', () => { void extract(); }, { signal });
  previous.addEventListener('click', () => select(selectedIndex - 1), { signal });
  next.addEventListener('click', () => select(selectedIndex + 1), { signal });
  copyOne.addEventListener('click', () => { void copy(false); }, { signal });
  copyAll.addEventListener('click', () => { void copy(true); }, { signal });
  questionList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-question-index]');
    if (button) select(Number(button.dataset.questionIndex));
  }, { signal });
  editor.addEventListener('input', () => {
    const draft = drafts[selectedIndex];
    if (!draft) return;
    draft.text = editor.value;
    const button = questionList.querySelector<HTMLButtonElement>(`[data-question-index="${selectedIndex}"]`);
    const text = button?.querySelector('.question-snippet');
    if (text) text.textContent = snippet(draft.text);
    if (button) button.title = `第 ${draft.question.number} 题 · ${snippet(draft.text)}`;
    copyOne.disabled = copying || !draft.text.trim();
    copyAll.disabled = copying || !drafts.some((item) => item.text.trim());
    manualCopy.hidden = true;
    announce('');
  }, { signal });
  render();
  return {
    element: root,
    update(value, pending) {
      settings = value;
      saving = pending;
      if (!enabled()) { generation++; extracting = false; }
      render();
    },
    dispose() {
      disposed = true;
      generation++;
      listeners.abort();
      drafts = [];
      editor.value = '';
      manualCopy.value = '';
      root.remove();
    },
  };
}
