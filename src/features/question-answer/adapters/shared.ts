import type { ApplicableAnswer, AnswerControlSnapshot, QuestionOption, QuestionPageSnapshot, QuestionSnapshot } from '../types';
import { normalizeProgramCode } from '../normalize';

export interface AnswerEditor {
  isReady?: boolean | number; iframe?: HTMLIFrameElement; body?: HTMLElement; container?: HTMLElement;
  getContent(): string; setContent(html: string, append?: boolean): void; fireEvent(event: string): void; sync?(): void;
}
export interface ChoiceControl { option: QuestionOption; element: HTMLElement; input?: HTMLInputElement; state: Element }
export interface TextControl { id: string; element: HTMLTextAreaElement | HTMLInputElement; editor?: AnswerEditor; waiting: boolean }
export interface MatchControl { id: string; element: HTMLSelectElement | HTMLInputElement; options: Array<{ option: QuestionOption; value: string; element: HTMLElement }> }
export interface ChildControl { id: string; choices: ChoiceControl[] }
export interface ProgramControl {
  editor?: { getValue(): string; setValue(value: string): void; getOption?(name: string): unknown };
  language: string; languageId: string; template: string; saved: string; waiting: boolean; readOnly: boolean;
}
export interface QuestionEntry {
  root: HTMLElement; snapshot: QuestionSnapshot; sourceId: string; blockedReason?: string; choices: ChoiceControl[];
  texts: TextControl[]; matches: MatchControl[]; children: ChildControl[]; program?: ProgramControl;
}
export interface PageInspection { snapshot: QuestionPageSnapshot; entries: QuestionEntry[] }

export function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '').trim();
}
export function signature(value: string): string {
  let hash = 2166136261;
  let second = 5381;
  for (let i = 0; i < value.length; i += 1) { hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ value.charCodeAt(i); }
  return `${value.length}-${(hash >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
export function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}
export function isPageVisible(win: Window): boolean {
  try { return !win.frameElement || visible(win.frameElement); } catch { return true; }
}
export function imageAddress(image: Element): string | undefined {
  const current = (image as HTMLImageElement).currentSrc;
  const value = image.getAttribute('data-original') || image.getAttribute('data-src') || image.getAttribute('data-lazy-src')
    || image.getAttribute('data-url') || current || image.getAttribute('srcset')?.split(',').at(-1)?.trim().split(/\s+/)[0] || image.getAttribute('src');
  if (!value) return undefined;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(value)) return value;
  try {
    const url = new URL(value, image.baseURI);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function disabled(element: Element): boolean {
  return Boolean(element.closest('[aria-disabled="true"],fieldset[disabled]')) || element.matches(':disabled,[readonly],[aria-readonly="true"],[contenteditable="false"]');
}

function choiceSelected(choice: ChoiceControl): boolean {
  if (choice.input) return choice.input.checked;
  return [choice.element, choice.state, choice.element.parentElement].some(element => element?.getAttribute('aria-checked') === 'true'
    || Array.from(element?.classList ?? []).some(name => name.startsWith('check_answer'))
    || Boolean(element?.querySelector('[class*="check_answer"]')));
}
function richText(doc: Document, html: string): { text: string; hasMedia: boolean } {
  const template = doc.createElement('template');
  template.innerHTML = html;
  function walk(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    const text = Array.from(node.childNodes, walk).join('');
    return ['P', 'DIV', 'PRE', 'LI'].includes(element.tagName) ? `${text}\n` : text;
  }
  return { text: normalizeText(walk(template.content)), hasMedia: Boolean(template.content.querySelector('img,math,svg,video,audio,object,iframe,canvas,table,hr,[data-latex]')) };
}
function editorText(editor: AnswerEditor): { text: string; hasMedia: boolean } {
  return richText(editor.body!.ownerDocument, editor.getContent());
}

export function readQuestionControl(win: Window, entry: QuestionEntry, pageComplete: boolean): AnswerControlSnapshot {
  const question = entry.snapshot;
  const answer: ApplicableAnswer = {};
  let hasContent = false;
  const codeEditor = question.kind === 'program' ? entry.program?.editor : undefined;
  const programCode = codeEditor ? normalizeProgramCode(codeEditor.getValue()) ?? '' : '';
  const programSaved = question.kind === 'program' ? entry.program?.saved ?? '' : '';
  const programTemplate = question.kind === 'program' ? entry.program?.template ?? '' : '';
  const programTemplateOnly = Boolean(programCode) && !programSaved && programCode === programTemplate;
  if (['single', 'multiple', 'judgement'].includes(question.kind)) { answer.choices = entry.choices.filter(choiceSelected).map(item => item.option.id); hasContent = answer.choices.length > 0; }
  if (question.kind === 'program') {
    // A page-provided skeleton is not an answer; a saved draft is.
    answer.code = programTemplateOnly ? '' : programCode || programSaved;
    hasContent = Boolean(programSaved) || Boolean(programCode && programCode !== programTemplate);
  }
  if (question.kind === 'completion') {
    const values = entry.texts.map(item => item.editor && !item.waiting ? editorText(item.editor)
      : item.waiting ? richText(win.document, item.element.value) : { text: normalizeText(item.element.value), hasMedia: false });
    answer.texts = values.map(item => item.text);
    hasContent = values.some(item => item.text || item.hasMedia);
  }
  if (question.kind === 'line') { answer.matches = entry.matches.map(item => item.options.find(option => option.value === item.element.value)?.option.id ?? ''); hasContent = answer.matches.some(Boolean); }
  if (question.kind === 'reader' || question.kind === 'fill') { answer.children = entry.children.map(child => ({ id: child.id, choices: child.choices.filter(choiceSelected).map(item => item.option.id) })); hasContent = answer.children.some(child => child.choices.length > 0); }
  const blocked = pageComplete || Boolean(entry.blockedReason) || disabled(entry.root) || !visible(entry.root) || !entry.root.isConnected
    || entry.choices.some(choice => disabled(choice.input ?? choice.element))
    || entry.texts.some(item => item.waiting || disabled(item.element) || Boolean(item.editor?.body && disabled(item.editor.body)))
    || entry.matches.some(item => disabled(item.element)) || entry.children.some(child => child.choices.some(choice => disabled(choice.input ?? choice.element)))
    || (question.kind === 'program' && (!entry.program || entry.program.waiting || entry.program.readOnly));
  const ready = question.supported && !blocked;
  const complete = question.kind === 'single' || question.kind === 'judgement' ? answer.choices?.length === 1
    : question.kind === 'multiple' ? Boolean(answer.choices?.length) : question.kind === 'completion' ? Boolean(answer.texts?.length && answer.texts.every(Boolean))
      : question.kind === 'line' ? Boolean(answer.matches?.length && answer.matches.every(Boolean))
        : question.kind === 'program' ? Boolean(programSaved) || Boolean(programCode && programCode !== programTemplate)
          : Boolean(answer.children?.length && answer.children.every(child => child.choices.length === 1));
  const content = JSON.stringify([answer, entry.texts.map(item => item.editor && !item.waiting ? item.editor.getContent() : item.element.value)]);
  // Version tracks the answer itself, not incidental DOM churn (CodeMirror cursor, scrollbars, run output).
  return { ready, version: signature(content), hasContent, complete, answer,
    ...(!ready ? { error: entry.blockedReason || question.reason || '题目已完成、不可编辑或答题控件未就绪。' } : {}) };
}
