import { isPlatformUrl } from '../../../shared/sites';
import { isQuestionSnapshot } from '../protocol';
import type { ApplicableAnswer, QuestionKind, QuestionSnapshot } from '../types';
import { disabled, imageAddress, isPageVisible, normalizeText, signature, visible, type ChoiceControl, type PageInspection, type QuestionEntry } from './shared';

const PAPER = 'main.common_look.ucenter-student';
const TITLE = '.common_look_title';
const LIST = '.common_look_main';
const GROUP = '.common-question';
const ITEM = '.questiono-item';
const SUBMIT = 'button.el-button--primary.el-button--small';
const ANSWER = '.common_test_answer';
const SCORE = '.common_test_score';
const RESULT_ROW = `:scope > .el-col > .questiono-main.questiono-student > ${ANSWER} > .el-col`;
const TOOLBOX = '[data-cx-toolbox],#cx-toolbox-root';
const OVERLAY = '.el-dialog__wrapper,.el-message-box__wrapper,.el-loading-mask,.v-modal,dialog[open],[role=dialog],[role=alertdialog]';
const GROUP_HEADING = /^(?:\d+\s*[.．、]\s*)?([^()（）]+?)\s*[（(]\s*共\s*(\d+)\s*题\s*[）)]$/;

export const ZJOOC_QUESTION_PAGE_MARKERS = [PAPER, TITLE, LIST, GROUP, ITEM, SUBMIT, ANSWER, SCORE].join(',');

interface PaperGroup { heading: string; kind: QuestionKind; declared: number; items: HTMLElement[] }
interface PaperShell { root: HTMLElement; title: string; list: HTMLElement }
interface Paper extends PaperShell { submit: HTMLButtonElement; groups: PaperGroup[] }

const documentKeys = new WeakMap<Document, string>();
const elementIds = new WeakMap<Element, number>();
let lastElementId = 0;

function elementId(element: Element): number {
  let id = elementIds.get(element);
  if (id === undefined) { id = ++lastElementId; elementIds.set(element, id); }
  return id;
}

function readPaperShell(doc: Document): PaperShell | undefined {
  if (!isPlatformUrl(doc.location?.href ?? doc.URL, 'zjooc')) return;
  const papers = Array.from(doc.querySelectorAll<HTMLElement>(PAPER)).filter(node => visible(node) && !node.closest(TOOLBOX));
  if (papers.length !== 1) return;
  const root = papers[0];
  const title = normalizeText(root.querySelector(`${TITLE} > h6`)?.textContent ?? '');
  const lists = root.querySelectorAll<HTMLElement>(LIST);
  if (!title || lists.length !== 1 || !visible(lists[0])) return;
  return { root, title, list: lists[0] };
}

function readSubmitButtons(list: HTMLElement): HTMLButtonElement[] {
  // This template keeps the test groups and its only submit button in sibling rows.
  return Array.from(list.querySelectorAll<HTMLButtonElement>(`:scope > .el-col > .el-col > ${SUBMIT}`))
    .filter(button => normalizeText(button.textContent ?? '') === '提交');
}

function readGroups(list: HTMLElement): PaperGroup[] {
  return Array.from(list.querySelectorAll<HTMLElement>(`:scope > .el-col > .el-col > ${GROUP}`), group => {
    const heading = normalizeText(group.previousElementSibling?.textContent ?? '');
    const match = GROUP_HEADING.exec(heading);
    const kind: QuestionKind = match?.[1] === '单选题' ? 'single' : match?.[1] === '判断题' ? 'judgement' : 'unsupported';
    const items = Array.from(group.querySelectorAll<HTMLElement>(`:scope > ${ITEM}`));
    return { heading, kind, declared: match ? Number(match[2]) : -1, items };
  });
}

function readPaper(doc: Document): Paper | undefined {
  const shell = readPaperShell(doc);
  if (!shell) return;
  const submits = readSubmitButtons(shell.list);
  if (submits.length !== 1) return;
  const groups = readGroups(shell.list);
  if (!groups.some(group => group.declared > 0 && group.items.length > 0)) return;
  return { ...shell, submit: submits[0], groups };
}

export function hasZjoocQuestionPage(doc: Document): boolean {
  return Boolean(readPaper(doc));
}

function readReviewGroups(doc: Document): PaperGroup[] | undefined {
  const shell = readPaperShell(doc);
  if (!shell || readSubmitButtons(shell.list).length > 0) return;
  const groups = readGroups(shell.list);
  if (groups.some(group => group.declared > 0 && group.items.some(item =>
    Array.from(item.querySelectorAll(`${RESULT_ROW} > ${SCORE}`)).some(visible)))) return groups;
}

export function hasZjoocReviewPage(doc: Document): boolean {
  return Boolean(readReviewGroups(doc));
}

/** Read the site's question content, without adjacent score, controls or dialog text. */
function questionText(root: Element, images: string[]): string {
  function walk(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.matches('script,style,noscript,button,input,textarea,select,[hidden],[aria-hidden=true]')
      || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute('style') ?? '')) return '';
    if (element.tagName === 'IMG') {
      const address = imageAddress(element);
      if (!address) return '[题目媒体不可用]';
      if (!images.includes(address)) images.push(address);
      return `[图片${images.indexOf(address) + 1}]`;
    }
    if (element.matches('iframe,video,audio,object,embed,canvas,svg,math,mjx-container')) return '[题目媒体不可用]';
    if (element.tagName === 'BR') return '\n';
    const text = Array.from(element.childNodes, walk).join('');
    return /^(P|DIV|LI|TR|PRE|H[1-6])$/.test(element.tagName) ? `${text}\n` : text;
  }
  return normalizeText(walk(root)).replace(/\n{3,}/g, '\n\n');
}

function readChoices(root: HTMLElement, kind: QuestionKind, images: string[]): ChoiceControl[] {
  const host = root.querySelectorAll(':scope > .el-col > .questiono-main.questiono-student');
  if (host.length !== 1) return [];
  const rows = Array.from(host[0].querySelectorAll(':scope > .common_test_option'));
  const choices: ChoiceControl[] = [];
  for (const [index, row] of rows.entries()) {
    const label = row.querySelector<HTMLLabelElement>(':scope > label.el-radio[role=radio]');
    const input = label?.querySelector<HTMLInputElement>(':scope > .el-radio__input > input.el-radio__original[type=radio]');
    const body = label?.querySelector(':scope > .el-radio__label');
    if (!label || !input?.value || !body || row.querySelectorAll('input,textarea,select,button').length !== 1) return [];
    if (input.name && Array.from(root.ownerDocument.getElementsByName(input.name)).some(node => node.matches('input[type=radio]')
      && (node as HTMLInputElement).form === input.form && !root.contains(node))) return [];
    const content = body.querySelector(':scope > .processing_img');
    const prefix = normalizeText(Array.from(body.childNodes, node => node.nodeType === 3 ? node.textContent ?? '' : '').join(''));
    const mark = /^([A-Z])[.．、]$/.exec(prefix)?.[1];
    if (kind === 'single' && (!mark || mark !== input.value || !content || body.children.length !== 1)) return [];
    const text = questionText(content ?? body, images);
    const option = { id: `option-${index + 1}`, label: mark ?? String.fromCharCode(65 + index), text };
    choices.push({ option, element: input, input, state: label });
  }
  if (host[0].querySelectorAll('input,textarea,select,button').length !== choices.length) return [];
  if (kind === 'judgement' && (choices.length !== 2 || !['正确', '错误'].every(text => choices.some(choice => choice.option.text === text)))) return [];
  if (choices.length < 2 || choices.length > 26 || choices.some(choice => !choice.option.text)
    || new Set(choices.map(choice => choice.input!.value)).size !== choices.length) return [];
  return choices;
}

function entryFor(root: HTMLElement, kind: QuestionKind, index: number, pageBlock?: string): QuestionEntry {
  const images: string[] = [];
  const titles = root.querySelectorAll(':scope > .questiono-header h6 .processing_img');
  const number = /^(\d+)\s*[.．、]$/.exec(normalizeText(root.querySelector(':scope > .questiono-header > b.fl')?.textContent ?? ''))?.[1];
  const stem = titles.length === 1 ? questionText(titles[0], images) : '';
  const choices = kind === 'unsupported' ? [] : readChoices(root, kind, images);
  const options = choices.map(choice => choice.option);
  const sourceId = String(elementId(root));
  const reason = kind === 'unsupported' ? '浙学此题型暂不支持，请手动作答。'
    : !number || !stem ? '未识别到完整题号或题干。'
      : !choices.length ? '未识别到完整的浙学选项。'
        : images.length > 16 || [stem, ...options.map(option => option.text)].some(text => text.includes('[题目媒体不可用]'))
          ? '题目媒体无法完整读取。' : undefined;
  const blockedReason = pageBlock ?? (choices.some(choice => !visible(choice.state) || disabled(choice.state) || disabled(choice.element)
    || choice.state.closest('.is-disabled,.is-readonly,[inert],[aria-busy=true]')
    || root.ownerDocument.defaultView?.getComputedStyle(choice.state).pointerEvents === 'none') ? '此题的选项当前不可编辑。'
    : choices.some(({ state, input }) => {
      // A native click may update checked even if Vue rejects the change.
      const selected = state.getAttribute('aria-checked') === 'true';
      return state.classList.contains('is-checked') !== selected || input?.checked !== selected;
    }) ? '浙学页面未确认选项状态，请核对本题后重试。' : undefined);
  const snapshot: QuestionSnapshot = {
    key: `zjooc-question:${sourceId}`, number: number ?? String(index + 1), kind, stem, options, fields: [], children: [], images,
    fingerprint: signature(JSON.stringify([number, kind, stem, options, images, choices.map(choice => choice.input?.value)])),
    supported: !reason, ...(reason ? { reason } : {}),
  };
  if (!isQuestionSnapshot(snapshot as unknown)) {
    snapshot.supported = false;
    snapshot.reason = '题目内容或图片超过处理上限，请手动作答。';
    snapshot.number = snapshot.number.slice(0, 1000);
    snapshot.stem = stem.slice(0, 32000);
    snapshot.options = options.map(option => ({ ...option, text: option.text.slice(0, 16000) }));
    snapshot.images = [];
  }
  return { root, sourceId, snapshot, choices, texts: [], matches: [], children: [], ...(blockedReason ? { blockedReason } : {}) };
}

function resultValue(item: HTMLElement, marker: string): string | undefined {
  const nodes = item.querySelectorAll(`${RESULT_ROW} > ${marker} + .common_test_text`);
  if (nodes.length !== 1) return;
  const value = nodes[0];
  const label = value.previousElementSibling;
  if (label && !value.childElementCount && visible(label) && visible(value)) return normalizeText(value.textContent ?? '');
}

function points(value: string | undefined): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return;
  const score = Number(value);
  if (Number.isFinite(score)) return score;
}

export function readZjoocReviewedQuestions(doc: Document): {
  questions: Array<{ question: QuestionSnapshot; answer: ApplicableAnswer }>;
  total: number;
} | undefined {
  const groups = readReviewGroups(doc);
  if (!groups) return;
  const questions: Array<{ question: QuestionSnapshot; answer: ApplicableAnswer }> = [];
  let total = 0;
  for (const group of groups) {
    for (const [index, item] of group.items.entries()) {
      if (!visible(item)) continue;
      total++;
      if (group.kind === 'unsupported') continue;
      const header = item.querySelectorAll(':scope > .questiono-header > .fr > span');
      if (header.length !== 1 || !visible(header[0])) continue;
      const maximum = points(/^(\d+(?:\.\d+)?)\s*分$/.exec(normalizeText(header[0].textContent ?? ''))?.[1]);
      // 浙学批阅页可以只显示考生答案；仅在逐题得分确认正满分时采纳它。
      if (!maximum || points(resultValue(item, SCORE)) !== maximum) continue;
      const value = resultValue(item, '.common_test_myanswer');
      if (!value) continue;
      const { snapshot, choices } = entryFor(item, group.kind, index);
      if (!snapshot.supported || snapshot.images.length || choices.some(choice => !visible(choice.state))) continue;
      const matches = choices.filter(choice => choice.input?.value === value);
      if (matches.length === 1) questions.push({ question: snapshot, answer: { choices: [matches[0].option.id] } });
    }
  }
  return { questions, total };
}

function completeCensus(paper: Paper, entries: QuestionEntry[]): boolean {
  if (!entries.length || paper.groups.some(group => group.declared < 1 || group.items.length !== group.declared || group.items.some(item => !visible(item)))) return false;
  const nodes = Array.from(paper.list.querySelectorAll(ITEM));
  return nodes.length === entries.length && entries.every((entry, index) => entry.root === nodes[index])
    && !Array.from(paper.root.querySelectorAll('.el-pagination,.pagination,[rel=next],[rel=prev]')).some(visible);
}

export function inspectZjoocQuestionPage(win: Window): PageInspection {
  const doc = win.document;
  let documentKey = documentKeys.get(doc);
  if (!documentKey) { documentKey = `answer-document:${win.crypto.randomUUID()}`; documentKeys.set(doc, documentKey); }
  const paper = isPageVisible(win) ? readPaper(doc) : undefined;
  if (!paper) return { entries: [], snapshot: {
    documentKey, scopeKey: signature(doc.URL), scene: 'unsupported', questions: [], complete: false, allLoaded: false,
    canSave: false, canSubmit: false, reason: '当前页面不是受支持的浙学测验答题页。',
  } };
  const dialog = Array.from(doc.querySelectorAll(OVERLAY)).some(element => !element.closest(TOOLBOX) && visible(element));
  const pageBlock = dialog ? '浙学页面有弹窗或正在加载，请处理后重试。'
    : !visible(paper.submit) || disabled(paper.submit) || paper.submit.closest('.is-disabled,.is-loading,[inert],[aria-busy=true]')
      || paper.root.closest('[inert],[aria-busy=true]') ? '浙学测验当前不可编辑。' : undefined;
  const entries = paper.groups.flatMap(group => group.items.filter(visible).map((item, index) => entryFor(item, group.kind, index, pageBlock)));
  // Vue may reuse the shell on navigation. Replacing the paper or its question content invalidates old commands.
  const scopeKey = signature(JSON.stringify([doc.URL, elementId(paper.root), elementId(paper.list), paper.title,
    paper.groups.map(group => group.heading), entries.map(entry => [entry.snapshot.key, entry.snapshot.fingerprint])]));
  return { entries, snapshot: {
    documentKey, scopeKey, scene: 'zjooc-test', questions: entries.map(entry => entry.snapshot), complete: false,
    allLoaded: completeCensus(paper, entries), canSave: false, canSubmit: false,
    ...(pageBlock ? { reason: pageBlock } : {}),
  } };
}
