import { extractThinkLadderQuestions, isThinkLadderUrl } from '../ai-answer/adapters/think-ladder';

/** Read-only adapters for known Chaoxing question markup. Never inspect answer values. */
export type ExtractedQuestion = {
  id: string;
  number: string;
  type: string;
  markdown: string;
  imageUrls: string[];
};

const CONTAINERS = '.questionLi, .TiMu, .question-item, .questionItem';
const STEMS = '.mark_name, .Zy_TItle, .question-title, .questionTitle';
const OPTIONS = '.mark_letter, .Zy_ulTop, .question-options, .questionOptions';
const EXCLUDED = [
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
  'textarea', 'select', 'button', 'canvas', 'svg', 'audio', 'video',
  '[hidden]', '[contenteditable]:not([contenteditable="false"])',
  '.stem_answer', '.stem_answer2', '.proceduralQue', '.codeEditWrap',
  '.CodeMirror', '.ace_editor', '.answer-editor', '.answerEditor',
  '.studentAnswer', '.student-answer', '.answer', '.answer-content',
  '.reference-answer', '.Py_answer', '.mark_answer',
  '.answer-analysis', '.answerAnalysis', '.analysis', '.eidt_button',
  '.compilation_result', '.result-container', '.maskBox',
  '[data-cx-toolbox]', '#cx-toolbox-root',
].join(', ');
const BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'DIV', 'DL', 'DT', 'DD', 'FIGURE',
  'FIGCAPTION', 'FOOTER', 'HEADER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'MAIN', 'P', 'SECTION',
]);
const NUMBER_PREFIX = /^\s*(?:第\s*)?([0-9]+|[一二三四五六七八九十百]+)\s*(?:题|[.．、:：)）])\s*/u;

type Context = {
  baseUrl: string;
  imageUrls: Set<string>;
  omitted: Set<Element>;
  codeFragments: string[];
};

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}

function isExcluded(element: Element): boolean {
  return element.matches(EXCLUDED)
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(element.getAttribute('style') ?? '');
}

function hasExcludedAncestor(element: Element, boundary: Document | Element): boolean {
  for (let current: Element | null = element; current && current !== boundary; current = current.parentElement) {
    if (isExcluded(current)) return true;
  }
  return false;
}

function safeUrl(value: string | null, baseUrl: string, image = false): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    if (url.username || url.password) return null;
    if (image ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function srcsetUrls(value: string | null): string[] {
  return (value ?? '').split(',').map((part) => part.trim().split(/\s+/)[0] ?? '').reverse();
}

function imageUrl(element: Element, context: Context): string | null {
  const candidates = [
    element.getAttribute('data-original'), element.getAttribute('data-src'),
    element.getAttribute('data-lazy-src'), element.getAttribute('data-url'),
    ...srcsetUrls(element.getAttribute('data-srcset')),
    ...srcsetUrls(element.getAttribute('srcset')), element.getAttribute('src'),
  ];
  if (element.parentElement?.tagName === 'PICTURE') {
    for (const source of element.parentElement.querySelectorAll('source')) {
      candidates.push(...srcsetUrls(source.getAttribute('srcset')));
    }
  }
  for (const candidate of candidates) {
    const result = safeUrl(candidate, context.baseUrl, true);
    if (result) return result;
  }
  return null;
}

function escapeLabel(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
}

function destination(url: string): string {
  // Angle destinations also work when the source URL contains parentheses.
  return `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

function children(element: Element, context: Context): string {
  return Array.from(element.childNodes, (node) => render(node, context)).join('');
}

function plainCode(node: Node, context: Context): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (isExcluded(element) || context.omitted.has(element) || element.tagName === 'INPUT') return '';
  if (element.tagName === 'BR') return '\n';
  return Array.from(element.childNodes, (child) => plainCode(child, context)).join('');
}

function fenceFor(value: string, minimum: number): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(Math.max(minimum, longest + 1));
}

function protectCode(value: string, context: Context): string {
  const index = context.codeFragments.push(value) - 1;
  return `\u0000cx-code-${index}\u0000`;
}

function restoreCode(value: string, context: Context): string {
  // NUL delimiters identify internal code tokens across whitespace normalization.
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u0000cx-code-(\d+)\u0000/g, (_, index: string) => context.codeFragments[Number(index)] ?? '');
}

function renderList(element: Element, context: Context): string {
  let number = Number.parseInt(element.getAttribute('start') ?? '1', 10);
  if (!Number.isFinite(number)) number = 1;
  const items = Array.from(element.children).filter((child) => child.tagName === 'LI' && !isExcluded(child));
  return '\n\n' + items.map((item) => {
    const specified = Number.parseInt(item.getAttribute('value') ?? '', 10);
    if (Number.isFinite(specified)) number = specified;
    const prefix = element.tagName === 'OL' ? `${number++}. ` : '- ';
    const content = normalize(children(item, context));
    return prefix + content.replace(/\n/g, '\n' + ' '.repeat(prefix.length));
  }).join('\n') + '\n\n';
}

function renderTable(element: Element, context: Context): string {
  const rows = Array.from(element.querySelectorAll('tr'))
    .filter((row) => row.closest('table') === element && !hasExcludedAncestor(row, element))
    .map((row) => Array.from(row.children)
      .filter((cell) => ['TH', 'TD'].includes(cell.tagName) && !isExcluded(cell))
      .flatMap((cell) => {
        const value = normalize(children(cell, context)).replace(/\n+/g, '<br>').replace(/\|/g, '\\|');
        const span = Math.min(20, Math.max(1, Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1));
        return [value, ...Array<string>(span - 1).fill('')];
      }));
  if (!rows.length) return '';
  const columns = Math.max(...rows.map((row) => row.length));
  const line = (row: string[]) => '| ' + Array.from({ length: columns }, (_, index) => row[index] ?? '').join(' | ') + ' |';
  return '\n\n' + [line(rows[0]), line(Array<string>(columns).fill('---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
}

function render(node: Node, context: Context): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/[\s\u00a0]+/g, ' ');
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (isExcluded(element) || context.omitted.has(element)) return '';
  const tag = element.tagName;
  if (tag === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    return ['text', 'number', 'search'].includes(type) ? '____' : '';
  }
  if (tag === 'BR') return '\n';
  if (tag === 'HR') return '\n\n---\n\n';
  if (tag === 'IMG') {
    const url = imageUrl(element, context);
    if (!url) return '';
    context.imageUrls.add(url);
    const alt = element.getAttribute('alt')?.trim() || element.getAttribute('title')?.trim() || '题目图片';
    return `![${escapeLabel(alt)}](${destination(url)})`;
  }
  if (tag === 'PRE') {
    const text = plainCode(element, context).replace(/\r\n?/g, '\n').replace(/^\n|\n$/g, '');
    const fence = fenceFor(text, 3);
    const language = /(?:^|\s)language-([\w+-]+)/.exec(element.querySelector('code')?.className ?? '')?.[1] ?? '';
    return `\n\n${protectCode(`${fence}${language}\n${text}\n${fence}`, context)}\n\n`;
  }
  if (tag === 'CODE') {
    const text = plainCode(element, context);
    const fence = fenceFor(text, 1);
    const pad = /^[`\s]|[`\s]$/.test(text) ? ' ' : '';
    return protectCode(`${fence}${pad}${text}${pad}${fence}`, context);
  }
  if (tag === 'UL' || tag === 'OL') return renderList(element, context);
  if (tag === 'TABLE') return renderTable(element, context);
  const text = children(element, context);
  if (tag === 'A') {
    const url = safeUrl(element.getAttribute('href'), context.baseUrl);
    return url && text.trim() && !element.querySelector('img')
      ? `[${escapeLabel(text.trim())}](${destination(url)})`
      : text;
  }
  if (tag === 'U' && !text.trim()) return '____';
  if (tag === 'BLOCKQUOTE') return '\n\n' + normalize(text).replace(/^/gm, '> ') + '\n\n';
  if (BLOCKS.has(tag)) return '\n\n' + text + '\n\n';
  if (tag === 'LI') return '\n' + text + '\n';
  return text;
}

function allIncludingRoot(root: Document | Element, selector: string): Element[] {
  const elements = Array.from(root.querySelectorAll(selector));
  if (root.nodeType === 1 && (root as Element).matches(selector)) elements.unshift(root as Element);
  return elements;
}

/** Extract known question stems and choice labels only; unknown pages return []. */
export function extractQuestions(root: Document | Element, baseUrl?: string): ExtractedQuestion[] {
  if (root.nodeType === 9 && isThinkLadderUrl((root as Document).location?.href ?? '')) {
    return extractThinkLadderQuestions(root as Document);
  }
  const questions: ExtractedQuestion[] = [];
  const seen = new Set<Element>();
  const containers = allIncludingRoot(root, CONTAINERS);
  // Standalone known stems support injected question fragments without copying page text.
  const standalone = allIncludingRoot(root, '.mark_name, .Zy_TItle')
    .filter((stem) => !stem.closest(CONTAINERS));
  const sources = [...containers, ...standalone];
  for (const container of sources) {
    const stem = container.matches(STEMS) ? container : container.querySelector(STEMS);
    if (!stem || seen.has(stem) || hasExcludedAncestor(stem, container)
      || hasExcludedAncestor(container, root) || isExcluded(container)) continue;
    if (!container.matches(STEMS) && stem.closest(CONTAINERS) !== container) continue;
    seen.add(stem);
    const metadata = Array.from(stem.querySelectorAll('.colorShallow, .question-type, .questionType'))
      .find((element) => /^\s*[(（]?[^(（)）]*题[^()（）]*[)）]?\s*$/u.test(element.textContent ?? ''));
    const typeText = metadata?.textContent ?? stem.textContent ?? '';
    const type = (container.getAttribute('typename')
      ?? container.getAttribute('data-question-type')
      ?? /[（(]\s*([^()（）]*?题)[^()（）]*[)）]/u.exec(typeText)?.[1]
      ?? metadata?.textContent
      ?? '').replace(/^[（(]\s*|\s*[)）]$/g, '').trim();
    const numberElement = stem.firstElementChild;
    const markedNumber = numberElement
      && (numberElement.matches('i.fl, .question-number, .questionNumber, .question-num'))
      ? /^\s*(?:第\s*)?([0-9]+|[一二三四五六七八九十百]+)\s*(?:题|[.．、:：)）])?\s*$/u.exec(numberElement.textContent ?? '')
      : null;
    const context: Context = {
      baseUrl: baseUrl ?? root.baseURI ?? 'https://mooc1.chaoxing.com/',
      imageUrls: new Set(),
      omitted: new Set([...(metadata ? [metadata] : []), ...(markedNumber && numberElement ? [numberElement] : [])]),
      codeFragments: [],
    };
    const stemText = normalize(children(stem, context));
    const prefix = NUMBER_PREFIX.exec(stemText);
    const number = markedNumber?.[1] ?? prefix?.[1] ?? String(questions.length + 1);
    let markdown = normalize(stemText.replace(NUMBER_PREFIX, '').replace(/^\s*[（(][^()（）]*?题[^()（）]*[)）]\s*/u, ''));
    const optionBlocks = Array.from(container.querySelectorAll(OPTIONS))
      .filter((option) => !stem.contains(option) && !hasExcludedAncestor(option, container))
      .filter((option) => option.closest(CONTAINERS) === container)
      .filter((option, _, options) => !options.some((other) => other !== option && other.contains(option)));
    for (const option of optionBlocks) {
      const text = normalize(children(option, context));
      if (text) markdown += '\n\n' + text;
    }
    markdown = restoreCode(normalize(markdown), context);
    if (!markdown) continue;
    const questionId = container.getAttribute('data-question-id') || container.id
      || container.getAttribute('data');
    questions.push({
      id: questionId || `question-${questions.length + 1}`,
      number,
      type,
      markdown,
      imageUrls: [...context.imageUrls],
    });
  }
  return questions;
}

/** Format the same representation used for a single question and for copy-all. */
export function formatQuestions(questions: ExtractedQuestion[]): string {
  return questions.map((question) => {
    const type = question.type ? `（${question.type}）` : '';
    return `## 第 ${question.number} 题${type}\n\n${question.markdown}`;
  }).join('\n\n---\n\n');
}
