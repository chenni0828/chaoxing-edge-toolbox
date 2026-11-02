import { QUESTION_BANK_ENDPOINT, normalizeQuestionBankConfig, validateQuestionBankConfig, type QuestionBankConfig } from './types';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Parse copied question bank configuration only. Never persist or evaluate handler strings or imported request settings. */
export function parseQuestionBankConfigInput(input: string): QuestionBankConfig {
  const text = input.trim();
  if (text.length > 65_536) throw new Error('题库配置过长，请只复制言溪题库的配置。');
  let token: unknown = text;
  if (text.startsWith('[') || text.startsWith('{')) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new Error('题库配置不是完整的 JSON，请重新复制官网的“题库配置”。'); }
    const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const matches = entries.filter(entry => record(entry) && entry.url === QUESTION_BANK_ENDPOINT);
    if (!matches.length) throw new Error('未找到言溪题库配置，请复制言溪官网的“题库配置”。');
    if (matches.length !== 1) throw new Error('发现多份言溪题库配置，请每次只导入一份。');
    const entry = matches[0];
    if (!record(entry) || !record(entry.data) || typeof entry.data.token !== 'string') {
      throw new Error('言溪题库配置中缺少 Token，请重新复制配置。');
    }
    token = entry.data.token;
  }
  const config = normalizeQuestionBankConfig({ token });
  validateQuestionBankConfig(config);
  return config;
}
