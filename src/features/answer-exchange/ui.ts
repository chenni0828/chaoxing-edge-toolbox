import type { WorkspaceView } from '../workspace-registry';
import type { ApplicableAnswer, QuestionAnswerController, QuestionAnswerState, QuestionSnapshot, QuestionTarget } from '../question-answer/types';
import { readZjoocReviewedQuestions } from '../question-answer/adapters/zjooc';
import { isFeatureEnabled, type Settings } from '../toolbox-settings/types';
import { clearLocalBank, readLocalBank, saveLocalBank } from '../local-question-bank/client';
import { localQuestionContentKey, matchLocalBank } from '../local-question-bank/matching';
import { canExportQuestion, createAnswerBatch, parseExchangePack, resolveAnswerPack, sanitizeBankEntry, serializeBankPack } from './protocol';
import { buildAnswerPrompt, buildBankPrompt } from './prompt';
import type { AnswerBatch, BankEntry } from './types';

interface Dependencies {
  controller: QuestionAnswerController;
  bank?: {
    read(): Promise<BankEntry[]>;
    save(entries: BankEntry[]): Promise<{ added: number; total: number }>;
    clear(): Promise<void>;
  };
}
interface Preview {
  answers: Array<{ target: QuestionTarget; answer: ApplicableAnswer }>;
  entries: BankEntry[];
  source: 'import' | 'local-bank';
  identity: string;
  stored: boolean;
  fromPage?: boolean;
  summary: string;
  rows: Array<{ title: string; message: string; collapsible?: boolean }>;
}
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Default folded; a manual expand is remembered for the lifetime of this page so a rebuilt panel cannot pop it open again. */
let exchangeOpen = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function button(text: string, action: string): HTMLButtonElement {
  const node = element('button', 'button', text);
  node.type = 'button';
  node.dataset.exchangeAction = action;
  return node;
}
function questionIdentity(state: QuestionAnswerState): string {
  return JSON.stringify(state.rows.map(row => [row.target.frameId, row.target.documentId, row.target.documentKey,
    row.target.scopeKey, row.target.question.key, row.target.question.fingerprint]));
}
function sameTarget(first: QuestionTarget, second: QuestionTarget): boolean {
  return first.frameId === second.frameId && first.documentId === second.documentId && first.documentKey === second.documentKey
    && first.scopeKey === second.scopeKey && first.question.key === second.question.key && first.question.fingerprint === second.question.fingerprint;
}
function answerText(question: QuestionSnapshot, answer: ApplicableAnswer): string {
  const selected = (ids: string[], options = question.options) => ids.map(id => {
    const option = options.find(item => item.id === id);
    return option ? `${option.label} · ${option.text}` : id;
  }).join('；');
  if (answer.code !== undefined) return answer.code || '未填写';
  if (answer.choices) return selected(answer.choices);
  if (answer.texts) return answer.texts.map((text, index) => `${index + 1}. ${text}`).join('\n');
  if (answer.matches) return answer.matches.map((id, index) => `${index + 1}. ${selected([id], question.fields[index]?.options)}`).join('\n');
  return (answer.children ?? []).map(child => `${question.children.findIndex(item => item.id === child.id) + 1}. ${selected(child.choices, question.children.find(item => item.id === child.id)?.options)}`).join('\n');
}
function questionText(question: QuestionSnapshot): string {
  const options = (values: QuestionSnapshot['options']) => values.map(option => `${option.label}. ${option.text}`).join('\n');
  const parts = [`题干：${question.stem}`];
  if (question.program) parts.push(`编程语言：${question.program.language}`);
  if (question.options.length) parts.push(`选项：\n${options(question.options)}`);
  for (const [index, field] of question.fields.entries()) parts.push(`填写项 ${index + 1}${field.options?.length ? `：\n${options(field.options)}` : '：____'}`);
  for (const [index, child] of question.children.entries()) parts.push(`子题 ${index + 1}：${child.stem}\n${options(child.options)}`);
  return parts.join('\n\n');
}

function entryRows(entries: BankEntry[], answerLabel: string): Preview['rows'] {
  return entries.map((entry, index) => ({
    title: `条目 ${index + 1} · ${entry.question.stem.slice(0, 45)}`,
    message: `${questionText(entry.question)}\n\n${answerLabel}：\n${answerText(entry.question, entry.answer)}`,
    collapsible: true,
  }));
}

/** External answers are parsed and previewed before a separate user action writes or stores them. */
export function createAnswerExchangeView(dependencies: Dependencies): WorkspaceView {
  return createExchangeView(dependencies.controller, dependencies.bank);
}

export function createPageBankExchangeView(): WorkspaceView {
  return createExchangeView();
}

function createExchangeView(controller?: QuestionAnswerController, bank = { read: readLocalBank, save: saveLocalBank, clear: clearLocalBank }): WorkspaceView {
  const pageBank = !controller;
  const root = element('details', 'answer-exchange');
  root.open = pageBank || exchangeOpen;
  root.addEventListener('toggle', () => { if (!pageBank) exchangeOpen = root.open; });
  root.append(element('summary', '', '外部 AI 与本地题库'));
  const content = element('div', 'answer-exchange-content');
  const hint = element('p', 'answer-exchange-hint', '点击“复制当前全部（含提示词）”，把完整题目和答题要求交给其他 AI；再粘贴返回的 JSON 并解析填入。已有答案保留，插件不会自动提交。');
  const promptActions = element('div', 'answer-exchange-actions');
  const copyAnswers = button('复制当前全部（含提示词）', 'copy-answers');
  copyAnswers.title = '一次复制当前页面全部可导出的题目和答案格式要求';
  const copyBank = button('复制题库生成提示词', 'copy-bank');
  promptActions.append(copyAnswers, copyBank);
  const pageBankHint = '从当前已批阅页面提取完整的纯文本单选题和判断题，只采纳逐题满分的答案。';
  const extractBank = button('提取当前页题库', 'extract-page-bank');
  extractBank.classList.add('primary');
  const extractActions = element('div', 'answer-exchange-actions');
  extractActions.append(extractBank);
  const input = element('textarea', 'answer-exchange-input');
  input.setAttribute('aria-label', pageBank ? '题库 JSON' : '外部 AI 返回的答案或题库 JSON');
  input.placeholder = pageBank ? '也可以粘贴题库 JSON' : '粘贴 AI 返回的答案或题库 JSON';
  input.spellcheck = false;
  input.maxLength = MAX_FILE_BYTES;
  const importActions = element('div', 'answer-exchange-actions');
  const parseFill = button('解析并填入', 'parse-fill');
  parseFill.classList.add('primary');
  const parse = button('仅解析预览', 'parse');
  const fileLabel = element('label', 'button answer-exchange-file-label', '导入 JSON 文件');
  const file = element('input', 'answer-exchange-file');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.setAttribute('aria-label', pageBank ? '导入题库 JSON 文件' : '导入答案或题库 JSON 文件');
  fileLabel.append(file);
  if (!pageBank) importActions.append(parseFill);
  importActions.append(parse, fileLabel);
  const bankLine = element('div', 'answer-exchange-bank-line');
  const bankCount = element('p', 'answer-exchange-hint', '本地题库：待读取');
  const bankActions = element('div', 'answer-exchange-actions');
  const match = button('匹配当前题目', 'match-bank');
  const clear = button('清空本地题库', 'clear-bank');
  if (!pageBank) bankActions.append(match);
  bankActions.append(clear);
  bankLine.append(bankCount, bankActions);
  const confirmation = element('div', 'answer-exchange-confirm');
  confirmation.hidden = true;
  const confirmClear = button('确认清空', 'confirm-clear');
  const cancelClear = button('取消', 'cancel-clear');
  confirmation.append(element('p', '', '清空后将删除本机全部本地题库条目。'), confirmClear, cancelClear);
  const preview = element('section', 'answer-exchange-preview');
  preview.hidden = true;
  const summary = element('p', 'answer-exchange-hint');
  const rows = element('ol', 'answer-exchange-results');
  rows.setAttribute('aria-label', '导入匹配预览');
  const previewActions = element('div', 'answer-exchange-actions');
  const apply = button('填写已匹配答案', 'apply');
  apply.classList.add('primary');
  const store = button('确认存入本地题库', 'store');
  const copyJson = button('复制题库 JSON', 'copy-bank-json');
  copyJson.classList.add('primary');
  if (!pageBank) previewActions.append(apply);
  if (pageBank) previewActions.append(copyJson);
  previewActions.append(store);
  preview.append(summary, rows, previewActions);
  const status = element('p', 'answer-exchange-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const fallback = element('textarea', 'answer-exchange-input');
  fallback.readOnly = true;
  fallback.hidden = true;
  fallback.setAttribute('aria-label', pageBank ? '待手动复制的题库 JSON' : '待手动复制的全部题目与提示词');
  content.append(hint, pageBank ? extractActions : promptActions, input, importActions, bankLine, confirmation, preview, status, fallback);
  root.append(content);
  const listeners = new AbortController();
  const { signal } = listeners;
  let settings: Settings | undefined;
  let saving = false;
  let disposed = false;
  let busy = false;
  let revision = 0;
  let state = controller?.getState();
  let identity = state ? questionIdentity(state) : '';
  let batch: AnswerBatch | undefined;
  let pending: Preview | undefined;
  let count: number | undefined;

  function enabled(): boolean { return Boolean(settings && isFeatureEnabled(settings, 'question-answer')); }
  function available(): boolean { return enabled() && !saving && !busy && !state?.running && !state?.previewing && !state?.sourceSaving && !disposed; }
  function currentRows() { return state?.rows ?? []; }
  function currentQuestions(): boolean { return available() && !state?.previewStale && currentRows().length > 0; }
  function tell(message: string, error = false): void {
    if (disposed) return;
    status.textContent = message;
    status.dataset.kind = error ? 'error' : 'success';
  }
  function render(): void {
    if (disposed) return;
    const ready = available();
    root.setAttribute('aria-busy', String(busy));
    copyAnswers.disabled = !currentQuestions() || !currentRows().some(row => canExportQuestion(row.target.question));
    copyBank.disabled = !ready;
    extractBank.disabled = !ready;
    if (pageBank) hint.textContent = settings && !enabled() ? '请在功能设置中启用「题库与 AI 答题」。' : pageBankHint;
    input.disabled = file.disabled = !ready;
    parseFill.disabled = parse.disabled = !ready || !input.value.trim();
    match.disabled = !currentQuestions();
    clear.disabled = !ready || count === 0;
    confirmClear.disabled = cancelClear.disabled = !ready;
    fileLabel.dataset.disabled = String(!ready);
    bankCount.textContent = count === undefined ? '本地题库：待读取' : `本地题库：${count} 条`;
    preview.hidden = !pending;
    apply.disabled = !currentQuestions() || !pending?.answers.length || pending.identity !== identity || !controller?.applyImportedAnswers;
    store.disabled = !ready || !pending?.entries.length || pending.stored;
    store.hidden = pending?.source === 'local-bank';
    copyJson.hidden = !pending?.fromPage;
    copyJson.disabled = !ready;
    if (!ready) confirmation.hidden = true;
  }
  function showPreview(value: Preview): void {
    pending = value;
    summary.textContent = value.summary;
    rows.replaceChildren();
    for (const item of value.rows) {
      const row = element('li');
      if (item.collapsible) {
        const detail = element('details', 'answer-exchange-entry');
        detail.append(element('summary', '', item.title), element('pre', '', item.message));
        row.append(detail);
      } else row.append(element('strong', '', item.title), element('span', '', item.message));
      rows.append(row);
    }
    render();
  }
  function resetPreview(): void {
    pending = undefined;
    rows.replaceChildren();
    summary.textContent = '';
    fallback.hidden = true;
    fallback.value = '';
  }
  function bankPreview(entries: BankEntry[], source: Preview['source']): Preview {
    const answers: Preview['answers'] = [];
    const details = source === 'import' ? entryRows(entries, '建议答案') : [];
    const current = currentRows();
    let conflicts = 0;
    let readOnly = 0;
    for (const row of current) {
      const result = matchLocalBank(row.target.question, entries);
      if (row.readOnly) readOnly++;
      else if (result.status === 'matched' && result.answer) answers.push({ target: structuredClone(row.target), answer: result.answer });
      if (result.status === 'conflict') conflicts++;
      const reason = row.readOnly ? '本题已完成或只读，未纳入填写。' : result.message;
      details.push({ title: `页面第 ${row.target.question.number} 题`, message: result.answer
        ? `${answerText(row.target.question, result.answer)}\n${reason}` : reason });
    }
    return { answers, entries, source, identity, stored: source === 'local-bank', rows: details,
      summary: pageBank ? `导入题库 ${entries.length} 条。请核对后确认存入本地题库。`
        : `${source === 'local-bank' ? '本地题库' : '导入题库'} ${entries.length} 条；当前 ${current.length} 题，可填写 ${answers.length} 题，冲突 ${conflicts} 题${readOnly ? `，只读 ${readOnly} 题` : ''}。${current.length ? '请核对后填写。' : '可先展开核对全部条目，确认存入后再读取页面题目。'}` };
  }
  function applyPreview(): void {
    if (!currentQuestions() || !pending?.answers.length || pending.identity !== identity
        || !controller?.applyImportedAnswers) {
      tell('没有找到可填入的当前题目答案，请仅解析预览后逐题核对。');
      return;
    }
    const selected = pending;
    const current = ++revision;
    busy = true;
    tell(`正在填入 ${selected.answers.length} 道已匹配答案…`);
    render();
    void controller.applyImportedAnswers(structuredClone(selected.answers), selected.source).then(() => {
      if (!disposed && current === revision) tell('已自动填入匹配答案，请检查页面后手动提交；已有答案保留。');
    }).catch(error => {
      if (current === revision) tell(error instanceof Error ? error.message : '填写失败，请重新核对题目。', true);
    }).finally(() => {
      if (current === revision) {
        busy = false;
        render();
      }
    });
  }
  function parseInput(autoFill: boolean): void {
    if (!available()) return;
    ++revision;
    resetPreview();
    confirmation.hidden = true;
    try {
      const pack = parseExchangePack(input.value);
      if (pack.mode === 'bank') {
        showPreview(bankPreview(pack.items, 'import'));
        tell('已解析题库并预览，尚未保存。');
      }
      else {
        if (pageBank) throw new Error('此处仅支持导入题库 JSON。');
        if (!batch || !state || state.previewStale) throw new Error('请先复制当前题目提示词，再导入同一批题目的答案。');
        const resolvedAnswers = resolveAnswerPack(pack, batch);
        const current = state.rows;
        const answers = resolvedAnswers.filter(item => current.some(row => !row.readOnly && sameTarget(row.target, item.target)));
        const entries = resolvedAnswers.map(item => ({ question: structuredClone(item.target.question), answer: item.answer }));
        const details = batch.items.map(item => {
          const found = pack.items.find(answer => answer.questionId === item.questionId);
          const resolved = resolvedAnswers.find(answer => sameTarget(answer.target, item.target));
          const currentRow = current.find(row => sameTarget(row.target, item.target));
          return { title: `第 ${item.target.question.number} 题`, message: !found ? '未返回答案，保留待处理。'
            : found.status === 'unanswerable' || !resolved ? 'AI 无法确定答案，保留待核对。'
              : `${answerText(item.target.question, resolved.answer)}\n${currentRow?.readOnly ? '本题已完成或只读，仅可存入题库，未纳入填写。' : '答案格式已通过核对；已有页面答案将保留。'}` };
        });
        const readOnly = resolvedAnswers.length - answers.length;
        showPreview({ answers, entries, source: 'import', identity, stored: false, rows: details,
          summary: `本批 ${batch.items.length} 题，可填写 ${answers.length} 题，未作答 ${batch.items.length - resolvedAnswers.length} 题${readOnly ? `，只读 ${readOnly} 题` : ''}。请核对后填写或存入题库。` });
        if (autoFill) {
          applyPreview();
          return;
        }
        tell('已解析并预览，尚未填写或保存。');
      }
    } catch (error) { tell(error instanceof Error ? error.message : '无法解析导入内容，请检查 JSON 格式。', true); }
    render();
  }
  function extractPageBank(): void {
    if (!available()) return;
    ++revision;
    resetPreview();
    confirmation.hidden = true;
    const review = readZjoocReviewedQuestions(document);
    if (!review) {
      tell('未找到已批阅的浙学测验，请等成绩和题目加载完成后再试。', true);
      render();
      return;
    }
    const entries = review.questions.filter(entry => canExportQuestion(entry.question) && localQuestionContentKey(entry.question))
      .map((entry, index) => sanitizeBankEntry(entry, index));
    const skipped = review.total - entries.length;
    if (entries.length) {
      showPreview({ answers: [], entries, source: 'import', identity, stored: false, fromPage: true,
        rows: entryRows(entries, '页面满分答案'),
        summary: `当前页 ${review.total} 题，可导入 ${entries.length} 题，跳过 ${skipped} 题。核对后可复制 JSON 分享，也可存入本地题库。` });
      tell('已提取并预览，尚未保存。');
    } else tell(`当前页 ${review.total} 题均未达到题库导入条件。`, true);
    render();
  }
  function copyPrompt(answerMode: boolean): void {
    if (!available() || (answerMode && !currentQuestions())) return;
    let text: string;
    let copiedMessage: string;
    try {
      if (answerMode) {
        const targets = currentRows().map(row => row.target);
        batch = createAnswerBatch(targets);
        text = buildAnswerPrompt(batch);
        const skipped = targets.length - batch.items.length;
        copiedMessage = `已复制当前 ${batch.items.length} 道完整题目及答题提示词${skipped ? `；已跳过 ${skipped} 道图片、缺字或暂不支持的题目` : ''}。请把 AI 返回的 JSON 粘贴回来。`;
        resetPreview();
      } else {
        text = buildBankPrompt();
        copiedMessage = '已复制题库生成提示词；请连同题目资料发给 AI。';
      }
    } catch (error) { tell(error instanceof Error ? error.message : '没有可导出的完整纯文本题目。', true); render(); return; }
    void copyText(text, copiedMessage, '提示词', answerMode ? '图片、缺字和暂不支持的题目已跳过。' : '');
  }
  async function copyText(text: string, copiedMessage: string, label: string, fallbackNote = ''): Promise<void> {
    const current = ++revision;
    busy = true;
    fallback.hidden = true;
    fallback.value = '';
    tell(`正在复制${label}…`);
    render();
    try {
      await navigator.clipboard.writeText(text);
      if (!disposed && current === revision) tell(copiedMessage);
    } catch {
      if (!disposed && current === revision) {
        fallback.value = text;
        fallback.hidden = false;
        fallback.focus();
        fallback.select();
        tell(`无法自动复制，请按 Ctrl+C 复制下方已选${label}。${fallbackNote}`);
      }
    } finally { if (current === revision) { busy = false; render(); } }
  }
  async function loadBank(matchQuestions: boolean): Promise<void> {
    if (!available() || (matchQuestions && !currentQuestions())) return;
    const current = ++revision;
    busy = true;
    confirmation.hidden = true;
    render();
    try {
      const entries = await bank.read();
      if (disposed || current !== revision) return;
      count = entries.length;
      if (matchQuestions) {
        showPreview(bankPreview(entries, 'local-bank'));
        tell('已匹配并预览本地题库，尚未填写。');
      }
    } catch (error) { if (current === revision) tell(error instanceof Error ? error.message : '本地题库读取失败，请重试。', true); }
    finally { if (current === revision) { busy = false; render(); } }
  }

  copyAnswers.addEventListener('click', () => copyPrompt(true), { signal });
  copyBank.addEventListener('click', () => copyPrompt(false), { signal });
  extractBank.addEventListener('click', extractPageBank, { signal });
  copyJson.addEventListener('click', () => {
    if (!available() || !pending?.fromPage) return;
    try {
      void copyText(serializeBankPack(pending.entries), '已复制题库 JSON，可粘贴到「外部 AI 与本地题库」中导入。', '题库 JSON');
    } catch (error) { tell(error instanceof Error ? error.message : '题库 JSON 生成失败。', true); }
  }, { signal });
  input.addEventListener('input', () => { if (busy) return; ++revision; resetPreview(); confirmation.hidden = true; status.textContent = ''; render(); }, { signal });
  parse.addEventListener('click', () => { parseInput(false); }, { signal });
  parseFill.addEventListener('click', () => { parseInput(true); }, { signal });
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (!available() || !selected) return;
    const current = ++revision;
    resetPreview();
    busy = true;
    render();
    void (async () => {
      try {
        if (selected.size > MAX_FILE_BYTES) throw new Error('文件超过 2 MB，请拆分后导入。');
        const text = await selected.text();
        if (disposed || current !== revision) return;
        input.value = text;
        busy = false;
        parseInput(false);
      } catch (error) { if (current === revision) tell(error instanceof Error ? error.message : '文件读取失败，请重试。', true); }
      finally { if (current === revision) { busy = false; render(); } file.value = ''; }
    })();
  }, { signal });
  match.addEventListener('click', () => { void loadBank(true); }, { signal });
  root.addEventListener('toggle', () => { if (root.open && count === undefined) void loadBank(false); }, { signal });
  apply.addEventListener('click', applyPreview, { signal });
  store.addEventListener('click', () => {
    if (!available() || !pending?.entries.length || pending.stored) return;
    const selected = pending;
    const current = ++revision;
    busy = true;
    render();
    void bank.save(structuredClone(selected.entries)).then(result => {
      if (disposed || current !== revision) return;
      selected.stored = true;
      count = result.total;
      tell(`已存入本地题库：新增 ${result.added} 条，共 ${result.total} 条；冲突答案匹配时会保留待核对。`);
    }).catch(error => { if (current === revision) tell(error instanceof Error ? error.message : '题库存储失败，请重试。', true); })
      .finally(() => { if (current === revision) { busy = false; render(); } });
  }, { signal });
  clear.addEventListener('click', () => { if (available() && count !== 0) { confirmation.hidden = false; } }, { signal });
  cancelClear.addEventListener('click', () => { if (available()) confirmation.hidden = true; }, { signal });
  confirmClear.addEventListener('click', () => {
    if (!available() || confirmation.hidden) return;
    const current = ++revision;
    busy = true;
    confirmation.hidden = true;
    render();
    void bank.clear().then(() => {
      if (disposed || current !== revision) return;
      count = 0;
      if (pending?.source === 'local-bank') resetPreview();
      tell('已清空本机本地题库。');
    }).catch(error => { if (current === revision) tell(error instanceof Error ? error.message : '题库清空失败，请重试。', true); })
      .finally(() => { if (current === revision) { busy = false; render(); } });
  }, { signal });
  const unsubscribe = controller?.subscribe(next => {
    const nextIdentity = questionIdentity(next);
    if (identity !== nextIdentity || (!state?.previewStale && next.previewStale)) {
      const hadContent = Boolean(batch || pending);
      ++revision;
      busy = false;
      batch = undefined;
      resetPreview();
      confirmation.hidden = true;
      if (hadContent) tell('题目页面已变化，已取消旧预览；请重新读取并复制题目提示词。');
    }
    identity = nextIdentity;
    state = next;
    render();
  });
  render();
  return {
    element: root,
    update(next, nextSaving) {
      if (disposed) return;
      const wasEnabled = enabled();
      settings = next;
      saving = nextSaving;
      if (wasEnabled && !enabled()) {
        ++revision;
        busy = false;
        batch = undefined;
        resetPreview();
      }
      render();
      if (pageBank && root.open && count === undefined && !wasEnabled) void loadBank(false);
    },
    dispose() { disposed = true; ++revision; unsubscribe?.(); listeners.abort(); batch = undefined; pending = undefined; root.remove(); },
  };
}
