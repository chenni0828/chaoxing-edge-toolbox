export const PACING_SETTINGS_KEY = 'toolbox.answer-pacing.v1';

export interface AnswerPacingPreferences {
  version: 1;
  bankIntervalMs: number;
  aiIntervalMs: number;
  minimumQuestionMs: number;
}

export const defaultAnswerPacing = (): AnswerPacingPreferences => ({
  version: 1, bankIntervalMs: 1000, aiIntervalMs: 1000, minimumQuestionMs: 3000,
});

export function normalizeAnswerPacing(value: unknown): AnswerPacingPreferences {
  const result = defaultAnswerPacing();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Partial<AnswerPacingPreferences>;
  for (const key of ['bankIntervalMs', 'aiIntervalMs', 'minimumQuestionMs'] as const) {
    const duration = input[key];
    if (typeof duration === 'number' && Number.isFinite(duration) && duration >= (key === 'minimumQuestionMs' ? 1 : 1000)
        && duration <= 2_147_483_647) result[key] = duration;
  }
  return result;
}

export function validateAnswerPacing(value: unknown): asserts value is AnswerPacingPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的答题速度设置。');
  const input = value as AnswerPacingPreferences;
  const normalized = normalizeAnswerPacing(input);
  if (input.version !== 1 || ['bankIntervalMs', 'aiIntervalMs', 'minimumQuestionMs'].some(key =>
    input[key as keyof AnswerPacingPreferences] !== normalized[key as keyof AnswerPacingPreferences])) {
    throw new Error('请求间隔至少为 1 秒，每题最低处理时间须大于 0，且不能超过计时上限。');
  }
}
