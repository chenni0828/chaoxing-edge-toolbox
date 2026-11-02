import { isFeatureEnabled, type Settings } from '../toolbox-settings/types';
import type { AnswerPageCommand } from './types';

export function canPreviewQuestions(settings: Settings | undefined): boolean {
  return Boolean(settings && (isFeatureEnabled(settings, 'question-answer') || isFeatureEnabled(settings, 'question-extract')));
}

/** Read-only extraction may inspect controls, but cannot request images or mutate a page. */
export function canUseQuestionAnswerOperation(settings: Settings | undefined, action: AnswerPageCommand['action'] | 'scan'): boolean {
  if (action === 'cancel') return true;
  if (action === 'scan' || action === 'inspect' || action === 'read') return canPreviewQuestions(settings);
  return Boolean(settings && isFeatureEnabled(settings, 'question-answer'));
}
