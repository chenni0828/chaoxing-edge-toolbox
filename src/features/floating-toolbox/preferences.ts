export const UI_SETTINGS_KEY = 'toolbox.ui.v1';
export type ToolboxView = 'page-tools' | 'answer';
export type ToolboxViewRequest = ToolboxView | 'question-extract' | 'ai-answer';

/** Keep old open-panel callers working without coupling workspace IDs to features. */
export function normalizeToolboxView(value: unknown): ToolboxView | undefined {
  if (value === 'page-tools' || value === 'question-extract') return 'page-tools';
  if (value === 'answer' || value === 'ai-answer') return 'answer';
  return undefined;
}

export interface UiPreferences {
  version: 1;
  x: number;
  y: number;
  minimized: boolean;
}

export function defaultUiPreferences(): UiPreferences {
  return { version: 1, x: 1, y: 0.12, minimized: true };
}

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const result = defaultUiPreferences();
  if (!value || typeof value !== 'object') return result;
  const input = value as Partial<UiPreferences>;
  for (const key of ['x', 'y'] as const) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = Math.max(0, Math.min(1, input[key]));
  }
  if (typeof input.minimized === 'boolean') result.minimized = input.minimized;
  return result;
}
