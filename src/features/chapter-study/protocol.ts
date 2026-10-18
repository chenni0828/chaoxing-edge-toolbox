import { STUDY_RATES, type StudyPageRequest, type StudyPageResult, type StudyPreferences, type StudySession } from './types';

export const STUDY_PORT = 'toolbox:chapter-study:frame';
export const STUDY_WAKE = 'toolbox:chapter-study:wake';
export const STUDY_CANCEL = 'toolbox:chapter-study:cancel';
const taskTypes = new Set(['video', 'courseware', 'audio-ppt', 'book', 'hyperlink', 'chapter-test']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const short = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max;
export const isStudyId = (value: unknown): value is string => typeof value === 'string' && /^[\w:-]{1,200}$/.test(value);
export function isStudyPreferences(value: unknown): value is StudyPreferences {
  return record(value) && value.version === 1 && typeof value.startMode === 'string' && ['first-unfinished', 'current-forward'].includes(value.startMode)
    && typeof value.muted === 'boolean' && STUDY_RATES.some(rate => rate === value.playbackRate)
    && (value.videoQuiz === undefined || value.videoQuiz === 'random' || value.videoQuiz === 'ignore')
    && (value.autoResume === undefined || typeof value.autoResume === 'boolean');
}
export function isStudyPageRequest(value: unknown): value is StudyPageRequest {
  if (!record(value)) return false;
  if ((value.action === 'navigate' || value.action === 'card' || value.action === 'refresh')
      && value.runId !== undefined && !isStudyId(value.runId)) return false;
  switch (value.action) {
    case 'inspect': case 'refresh': return true;
    case 'configure': return isStudyPreferences(value.preferences);
    case 'run': return isStudyId(value.runId) && short(value.taskKey, 300) && isStudyId(value.documentKey) && isStudyPreferences(value.preferences)
      && (value.verifiedJobId === undefined || short(value.verifiedJobId, 100))
      && (value.resumeOnly === undefined || typeof value.resumeOnly === 'boolean');
    case 'cancel': return isStudyId(value.runId);
    case 'navigate': return typeof value.chapterId === 'string' && /^\d{1,30}$/.test(value.chapterId);
    case 'card': return Number.isSafeInteger(value.cardIndex) && (value.cardIndex as number) >= 0 && (value.cardIndex as number) < 1000;
    default: return false;
  }
}
export function isStudyPageResult(value: unknown): value is StudyPageResult {
  if (!record(value) || typeof value.ok !== 'boolean' || (value.error !== undefined && !short(value.error))) return false;
  if (value.cacheMiss !== undefined && typeof value.cacheMiss !== 'boolean') return false;
  if (value.outcome !== undefined) {
    const outcome = value.outcome;
    if (!record(outcome) || typeof outcome.status !== 'string' || !['acted', 'skipped', 'attention'].includes(outcome.status) || !short(outcome.message)) return false;
    if (outcome.chapterIncomplete !== undefined && typeof outcome.chapterIncomplete !== 'boolean') return false;
  }
  if (value.snapshot !== undefined) {
    const snapshot = value.snapshot;
    if (!record(snapshot) || !isStudyId(snapshot.documentKey) || typeof snapshot.cardReady !== 'boolean'
        || (snapshot.warning !== undefined && !short(snapshot.warning)) || !Array.isArray(snapshot.tasks) || snapshot.tasks.length > 300) return false;
    if (snapshot.chapterId !== undefined && (typeof snapshot.chapterId !== 'string' || !/^\d{1,30}$/.test(snapshot.chapterId))) return false;
    if (snapshot.attachmentJobIds !== undefined && (!Array.isArray(snapshot.attachmentJobIds) || snapshot.attachmentJobIds.length > 1000
        || !snapshot.attachmentJobIds.every(jobId => short(jobId, 100)))) return false;
    if (!snapshot.tasks.every(task => record(task) && short(task.key, 300) && typeof task.type === 'string' && taskTypes.has(task.type)
        && short(task.title, 300) && short(task.jobId, 100) && typeof task.isTaskPoint === 'boolean')) return false;
  }
  return true;
}
export function isStudySession(value: unknown): value is StudySession {
  if (!record(value) || !short(value.courseKey, 300) || !isStudyId(value.runId) || !short(value.anchorId, 100)
      || typeof value.paused !== 'boolean' || !Number.isSafeInteger(value.completed) || (value.completed as number) < 0
      || (value.expectedChapterId !== undefined && !short(value.expectedChapterId, 100))
      || (value.finished !== undefined && typeof value.finished !== 'boolean')
      || (value.startMode !== undefined && value.startMode !== 'first-unfinished' && value.startMode !== 'current-forward')) return false;
  return Array.isArray(value.visited) && value.visited.length <= 5000 && value.visited.every(id => short(id, 100))
    && Array.isArray(value.skipped) && value.skipped.length <= 5000 && value.skipped.every(item => short(item, 500));
}
