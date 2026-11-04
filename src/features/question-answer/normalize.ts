import type { ApplicableAnswer, QuestionOption, QuestionSnapshot } from './types';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function strings(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.length && value.every(item => typeof item === 'string' && item.trim()) ? value.map(item => item.trim()) : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return strings(parsed);
  } catch { /* Plain answers are the usual question-bank response. */ }
  return [text];
}

function split(value: unknown): string[] | undefined {
  const result = strings(value);
  if (!result || result.length !== 1) return result;
  // A literal option/whole text is always attempted before this delimiter parser.
  const separator = ['===', '###', '---', '#', '|', '；', ';', '\n'].find(item => result[0].includes(item));
  return separator ? result[0].split(separator).map(item => item.trim()).filter(Boolean) : result;
}

function uniqueOption(value: string, options: QuestionOption[]): string | undefined {
  const token = normalized(value);
  const exactIds = options.filter(option => option.id === value);
  if (exactIds.length === 1) return exactIds[0].id;
  const matching = options.filter(option => normalized(option.text) === token || normalized(option.label) === token);
  return matching.length === 1 ? matching[0].id : undefined;
}

const trueWords = new Set(['对', '正确', '是', '√', 'true', 't', 'yes', '1', '對']);
const falseWords = new Set(['错', '错误', '否', '×', 'x', 'false', 'f', 'no', '0', '錯']);
function booleanValue(value: string): boolean | undefined {
  const word = normalized(value).toLowerCase();
  return trueWords.has(word) ? true : falseWords.has(word) ? false : undefined;
}

/** Code keeps indentation and blank lines; only transport artifacts and fence wrappers are removed. */
export function normalizeProgramCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(text);
  if (fenced) text = fenced[1];
  text = text.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n').trimEnd();
  if (!text.trim() || text.length > 32000) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return undefined;
  return text;
}

function choices(value: unknown, options: QuestionOption[], multiple: boolean, judgement = false): string[] | undefined {
  let tokens = strings(value);
  if (!tokens) return undefined;
  if (tokens.length === 1) {
    const exact = uniqueOption(tokens[0], options);
    if (exact) return [exact];
    if (judgement) {
      const expected = booleanValue(tokens[0]);
      const matches = expected === undefined ? [] : options.filter(option => booleanValue(option.text) === expected);
      if (matches.length === 1) return [matches[0].id];
    }
    if (multiple) {
      if (/^[A-Z]{2,26}$/.test(tokens[0])) tokens = [...tokens[0]];
      else if (/^[A-Z](?:\s*[,，、]\s*[A-Z])+$/.test(tokens[0])) tokens = tokens[0].split(/\s*[,，、]\s*/);
      else tokens = split(tokens);
    }
  }
  if (!tokens?.length || (!multiple && tokens.length !== 1)) return undefined;
  const ids = tokens.map(token => uniqueOption(token, options));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return undefined;
  // Canonical DOM order also makes write read-back comparisons deterministic.
  return options.filter(option => ids.includes(option.id)).map(option => option.id);
}

/** Normalize only unambiguous answers. Similarity scores are never enough to fill a page. */
export function normalizeAnswer(question: QuestionSnapshot, raw: unknown): ApplicableAnswer | undefined {
  if (!question.supported || question.kind === 'unsupported' || question.textRecognition?.status === 'pending') return undefined;
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    try { value = text.startsWith('[') || text.startsWith('{') ? JSON.parse(text) as unknown : text; } catch { value = text; }
  }
  const object = record(value);
  if (object && 'answer' in object && !('choices' in object || 'texts' in object || 'matches' in object || 'children' in object)) {
    return Object.keys(object).length === 1 ? normalizeAnswer(question, object.answer) : undefined;
  }
  if (object) {
    const expected = ['single', 'multiple', 'judgement'].includes(question.kind) ? 'choices'
      : question.kind === 'completion' ? 'texts' : question.kind === 'line' ? 'matches'
        : question.kind === 'program' ? 'code' : 'children';
    if (Object.keys(object).length !== 1 || !(expected in object)) return undefined;
  }
  if (question.kind === 'single' || question.kind === 'multiple' || question.kind === 'judgement') {
    const result = choices(object?.choices ?? value, question.options, question.kind === 'multiple', question.kind === 'judgement');
    return result ? { choices: result } : undefined;
  }
  if (question.kind === 'program') {
    // One code box preserves indentation, quotes, backslashes and blank lines literally.
    const code = normalizeProgramCode(object?.code ?? value);
    return code ? { code } : undefined;
  }
  if (question.kind === 'completion') {
    // One text box preserves semicolons, newlines, formulas and code literally.
    const result = question.fields.length === 1 ? strings(object?.texts ?? value) : split(object?.texts ?? value);
    return result?.length === question.fields.length && result.every(text => text.trim() && text.length <= 32000)
      ? { texts: result } : undefined;
  }
  if (question.kind === 'line') {
    const tokens = split(object?.matches ?? value);
    if (!tokens || tokens.length !== question.fields.length) return undefined;
    const result = tokens.map((token, index) => uniqueOption(token, question.fields[index].options ?? []));
    return result.every((id): id is string => Boolean(id)) ? { matches: result } : undefined;
  }
  if (question.kind === 'fill' || question.kind === 'reader') {
    const children = object?.children;
    if (Array.isArray(children)) {
      if (children.length !== question.children.length) return undefined;
      const values = children.map(record);
      if (values.some(child => !child || Object.keys(child).length !== 2 || !('id' in child) || !('choices' in child))
        || new Set(values.map(child => child?.id)).size !== values.length) return undefined;
      const result = question.children.map(child => {
        const entry = values.find(item => item?.id === child.id);
        const selected = choices(entry?.choices, child.options, false);
        return selected ? { id: child.id, choices: selected } : undefined;
      });
      return result.every((child): child is { id: string; choices: string[] } => Boolean(child)) ? { children: result } : undefined;
    }
    const tokens = split(value);
    if (!tokens || tokens.length !== question.children.length) return undefined;
    const result = question.children.map((child, index) => {
      const selected = choices(tokens[index], child.options, false);
      return selected ? { id: child.id, choices: selected } : undefined;
    });
    return result.every((child): child is { id: string; choices: string[] } => Boolean(child)) ? { children: result } : undefined;
  }
  return undefined;
}

/** One text representation for bank options and numbered image suggestions. */
export function questionOptionsText(question: QuestionSnapshot): string {
  if (question.kind === 'line') return question.fields.map((field, index) => `第 ${index + 1} 项\n${(field.options ?? []).map(option => `${option.label}. ${option.text}`).join('\n')}`).join('\n\n');
  if (question.kind === 'reader' || question.kind === 'fill') return question.children.map((child, index) => `第 ${index + 1} 小题${child.stem ? `：${child.stem}` : ''}\n${child.options.map(option => `${option.label}. ${option.text}`).join('\n')}`).join('\n\n');
  return question.options.map(option => option.text).join('\n');
}
