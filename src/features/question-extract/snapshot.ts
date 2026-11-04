import { QUESTION_MARKDOWN_LIMIT, type QuestionKind, type QuestionOption, type QuestionSnapshot } from '../question-answer/types';
import { extractQuestions, formatQuestions } from './extract';

const kindLabels: Record<QuestionKind, string> = {
  single: '单选题', multiple: '多选题', judgement: '判断题', completion: '文本填写题',
  line: '连线／匹配题', fill: '完形填空', reader: '阅读理解', program: '程序题', unsupported: '未识别题型',
};

function imageText(address: string | undefined, number: number): string {
  if (address?.startsWith('data:')) return `[图片${number}：内嵌图片，请在原页面查看]`;
  try {
    const url = new URL(address ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return `![图片${number}](<${url.href.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`;
    }
  } catch { /* An unavailable image remains visible as a placeholder. */ }
  return `[图片${number}：地址不可用，请在原页面查看]`;
}

function textWithImages(text: string, question: QuestionSnapshot, seen?: Set<number>): string {
  return text.replace(/\[图片(\d+)\]/g, (_, value: string) => {
    const number = Number(value);
    seen?.add(number);
    return imageText(question.images[number - 1], number);
  });
}

function optionsText(options: QuestionOption[], question: QuestionSnapshot, seen?: Set<number>): string {
  return options.map(option => `${option.label}. ${textWithImages(option.text, question, seen)}`).join('\n\n');
}

function fieldsText(question: QuestionSnapshot, seen?: Set<number>): string {
  return question.fields.map((field, index) => {
    const label = question.kind === 'line' ? `匹配项 ${index + 1}` : `填写位置 ${index + 1}`;
    const choices = optionsText(field.options ?? [], question, seen);
    return choices ? `### ${label}\n\n${choices}` : `${label}：____`;
  }).join('\n\n');
}

function optionPrefix(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:[-*+]\\s+)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*(?:[.．、:：)）]|(?=\\s{2,}|$))\\s*`);
}

function plainMarkdownText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\(\s*<?[^)>]+>?\s*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(\s*<?[^)>]+>?\s*\)/g, '$1')
    .replace(/```[^\n]*\n?|```/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function markdownHasOption(markdown: string, question: QuestionSnapshot, target: QuestionOption): boolean {
  const lines = markdown.split(/\r?\n/);
  const prefix = optionPrefix(target.label);
  const start = lines.findIndex(line => prefix.test(line));
  if (start < 0) return false;
  const nextOption = new RegExp(`^\\s*(?:[-*+]\\s+)?(?:\\*\\*)?(?:${question.options
    .map(option => option.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\*\\*)?\\s*(?:[.．、:：)）]|(?=\\s{2,}|$))\\s*`);
  let chunk = lines[start].replace(prefix, '');
  for (let index = start + 1; index < lines.length && !nextOption.test(lines[index]); index += 1) chunk += `\n${lines[index]}`;
  const expected = plainMarkdownText(textWithImages(target.text, question));
  return !expected || plainMarkdownText(chunk).includes(expected);
}

function appendMissingOptions(markdown: string, question: QuestionSnapshot): string {
  const seen = new Set<number>();
  const missing = question.options.filter(option => !markdownHasOption(markdown, question, option))
    .map(option => `${option.label}. ${textWithImages(option.text, question, seen)}`);
  return missing.length ? [markdown.trimEnd(), missing.join('\n\n')].filter(Boolean).join('\n\n') : markdown;
}

function programNote(question: QuestionSnapshot): string {
  return question.program ? `\n\n编程语言：${question.program.language}` : '';
}

/** Format only the already loaded question snapshot, never controls, generated answers or a new scan. */
export function formatQuestionSnapshot(question: QuestionSnapshot): string {
  if (question.markdown?.trim() && question.markdown.length <= QUESTION_MARKDOWN_LIMIT) {
    return appendMissingOptions(question.markdown, question) + programNote(question);
  }
  const seen = new Set<number>();
  const parts = [textWithImages(question.stem, question, seen), optionsText(question.options, question, seen), fieldsText(question, seen)];
  for (const [index, child] of question.children.entries()) {
    parts.push(`### 子题 ${index + 1}\n\n${textWithImages(child.stem, question, seen)}\n\n${optionsText(child.options, question, seen)}`);
  }
  question.images.forEach((address, index) => { if (!seen.has(index + 1)) parts.push(imageText(address, index + 1)); });
  return formatQuestions([{ id: question.key, number: question.number, type: kindLabels[question.kind],
    markdown: parts.filter(part => part.trim()).join('\n\n') + programNote(question), imageUrls: [], warning: question.reason }]);
}

export function formatQuestionSnapshots(questions: readonly QuestionSnapshot[]): string {
  return questions.map(formatQuestionSnapshot).join('\n\n---\n\n');
}

/** Bind rich copy text to the exact discovered root; only explicit page inspection calls this. */
export function captureQuestionSnapshotMarkdown(question: QuestionSnapshot, root: Element): string | undefined {
  const extracted = extractQuestions(root);
  if (extracted.length !== 1) return;
  const content = extracted[0];
  // Form controls are excluded by extraction. Export their static count/options, never their values.
  const fields = fieldsText(question);
  const markdown = formatQuestions([{ ...content, number: question.number,
    type: content.type || kindLabels[question.kind], markdown: [content.markdown, fields].filter(Boolean).join('\n\n') }]);
  return markdown.length <= QUESTION_MARKDOWN_LIMIT ? markdown : undefined;
}
