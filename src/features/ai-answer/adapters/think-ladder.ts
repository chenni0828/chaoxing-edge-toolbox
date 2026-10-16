import type { ExtractedQuestion } from '../../question-extract/extract';
import type { CurrentQuestion, PageQuestionState } from '../types';

const PAGE_PATH = '/mooc2-ans-vue/think-ladder/answer/pc-index';
const TOOLBOX = '[data-cx-toolbox], #cx-toolbox-root, .ocs-app, [data-ocs], #ocs-app';
const OMIT = `script, style, noscript, template, iframe, textarea, button, .tags, .conOld, .preAppendContentBox, ${TOOLBOX}`;
const BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'PRE', 'BLOCKQUOTE', 'TR']);

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function isThinkLadderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'mooc2-ans.chaoxing.com'
      && url.pathname.replace(/\/$/, '') === PAGE_PATH;
  } catch {
    return false;
  }
}

function chat(doc: Document): Element | null {
  return doc.querySelector('#realApp #chatScroll');
}

function messages(root: Element): Element[] {
  return Array.from(root.querySelectorAll('.cthree, .ctwo')).filter((message) =>
    !message.closest(TOOLBOX) && message.closest('#chatScroll') === root
    && !message.parentElement?.closest('.cthree, .ctwo'));
}

function visible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true'
      || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(current.getAttribute('style') ?? '')) return false;
  }
  return true;
}

function imageUrl(element: Element): string | undefined {
  for (const value of [element.getAttribute('data-original'), element.getAttribute('data-src'), element.getAttribute('src')]) {
    if (!value) continue;
    try {
      const url = new URL(value, element.baseURI);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* Ignore malformed image links. */ }
  }
  return undefined;
}

function render(node: Node, imageUrls: Set<string>, withImages: boolean): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (element.matches(OMIT) || !visible(element)) return '';
  if (element.tagName === 'BR') return '\n';
  if (element.tagName === 'IMG') {
    const url = imageUrl(element);
    if (url) imageUrls.add(url);
    return withImages && url ? `\n[题干图片](<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>)\n` : '';
  }
  const value = Array.from(element.childNodes, (child) => render(child, imageUrls, withImages)).join('');
  return BLOCKS.has(element.tagName) ? `\n${value}\n` : value;
}

function questionParts(message: Element) {
  const source = message.querySelector('.cthreecontent > .dataCon, .cthreecontent > .dataCon5');
  if (!source || source.querySelector('.successTit')) return undefined;
  const type = source.querySelector(':scope > .topicType')?.textContent?.trim();
  const stemNode = source.querySelector(':scope > .con');
  if (!type || !stemNode || !visible(stemNode)) return undefined;
  const imageUrls = new Set<string>();
  const stem = normalize(render(stemNode, imageUrls, false));
  const markdown = normalize(render(stemNode, imageUrls, true));
  if (!stem && !imageUrls.size) return undefined;
  const tags = source.querySelector('.tags')?.textContent ?? '';
  // Tags are auxiliary data. Discard the whole AI 出题提示 segment rather than
  // allowing the source page's question-generation instructions into our prompt.
  const assessment = normalize(/维度\s*[:：]([\s\S]*?)(?=AI\s*出题提示\s*[:：]|知识点\s*[:：]|$)/iu.exec(tags)?.[1] ?? '')
    .replace(/^考核维度描述\s*[:：]\s*/u, '').replace(/\s*--\s*$/u, '').trim();
  const knowledgeText = normalize(/知识点\s*[:：]([\s\S]*?)(?=AI\s*出题提示\s*[:：]|$)/iu.exec(tags)?.[1] ?? '');
  const knowledgePoints = knowledgeText.split(/[,，、;；\n]/u).map((value) => value.trim()).filter(Boolean);
  return { type, stem, markdown, assessment, knowledgePoints, imageUrls: [...imageUrls], hasImages: !!stemNode.querySelector('img') };
}

function currentQuestion(parts: NonNullable<ReturnType<typeof questionParts>>, index: number): CurrentQuestion {
  return {
    key: `think-ladder-${index}-${hash(parts.stem)}`,
    fingerprint: hash(JSON.stringify([parts.type, parts.stem, parts.knowledgePoints, parts.assessment])),
    type: '简答题', stem: parts.stem,
    knowledgePoints: parts.knowledgePoints, assessment: parts.assessment,
  };
}

/** Read only the newest real chat message; never fall back to a historical task. */
export function readThinkLadderState(doc: Document): PageQuestionState {
  if (!isThinkLadderUrl(doc.location.href)) return { state: 'unsupported', message: 'AI 作答目前支持思维阶梯页面的简答题。' };
  const root = chat(doc);
  if (!root) return { state: 'waiting', message: '等待练习页面加载。' };
  const entries = messages(root);
  const latest = entries.at(-1);
  if (!latest) return { state: 'waiting', message: '等待当前题目。' };
  if (latest.matches('.ctwo')) return { state: 'waiting', message: '当前题目已作答，等待下一题。' };
  if (latest.querySelector('.successTit')) return { state: 'complete', message: '本次练习已完成。' };
  const loading = latest.querySelectorAll('[aria-busy="true"], .loading, .loadmore, .thinking, .answer-loading, .generating');
  if (Array.from(loading).some(visible)) return { state: 'waiting', message: '题目正在加载，稍后再检测。' };
  const parts = questionParts(latest);
  if (!parts) return { state: 'waiting', message: '等待新的有效题目。' };
  if (parts.type !== '简答题') return { state: 'unsupported', message: `当前题型为${parts.type}，首版仅支持简答题。` };
  if (parts.hasImages) return { state: 'unsupported', message: '当前题干含图片，请手动作答；可在题目提取中复制图片链接。' };
  return { state: 'question', question: currentQuestion(parts, entries.length - 1) };
}

/** Historical question extraction intentionally excludes students' replies and feedback. */
export function extractThinkLadderQuestions(doc: Document): ExtractedQuestion[] {
  if (!isThinkLadderUrl(doc.location.href)) return [];
  const root = chat(doc);
  if (!root) return [];
  const result: ExtractedQuestion[] = [];
  messages(root).forEach((message, index) => {
    if (!message.matches('.cthree')) return;
    const parts = questionParts(message);
    if (!parts) return;
    result.push({
      id: `think-ladder-${index}-${hash(parts.stem)}`, number: String(result.length + 1),
      type: parts.type, markdown: parts.markdown, imageUrls: parts.imageUrls,
    });
  });
  return result;
}
