export const QUESTION_BANK_SETTINGS_KEY = 'toolbox.question-bank.v1';
export const QUESTION_BANK_ORIGIN = 'https://tk.enncy.cn/*';
export const QUESTION_BANK_ENDPOINT = 'https://tk.enncy.cn/query';

export interface QuestionBankConfig { version: 1; token: string }
export interface QuestionBankStatus { configured: boolean; authorized: boolean; message: string }

export function emptyQuestionBankConfig(): QuestionBankConfig { return { version: 1, token: '' }; }

export function normalizeQuestionBankConfig(value: unknown): QuestionBankConfig {
  if (!value || typeof value !== 'object') return emptyQuestionBankConfig();
  const token = (value as Partial<QuestionBankConfig>).token;
  return { version: 1, token: typeof token === 'string' ? token.trim() : '' };
}

export function validateQuestionBankConfig(config: QuestionBankConfig): void {
  if (!config.token) throw new Error('请填写言溪题库 Token。');
  if (config.token.length > 4096 || /[^\x21-\x7e]/.test(config.token) || /^['"]|['"]$/.test(config.token)) {
    throw new Error('Token 只填写凭证本身，不要包含引号、空格或换行。');
  }
}
