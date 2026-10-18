export const STUDY_RATES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 6, 8, 16] as const;
export const STUDY_SETTINGS_KEY = 'toolbox.chapter-study.v1';
export type StudyStartMode = 'first-unfinished' | 'current-forward';
export type StudyVideoQuiz = 'random' | 'ignore';
export interface StudyPreferences { version: 1; startMode: StudyStartMode; playbackRate: number; muted: boolean; videoQuiz: StudyVideoQuiz; autoResume: boolean }
export function defaultStudyPreferences(): StudyPreferences {
  return { version: 1, startMode: 'first-unfinished', playbackRate: 1, muted: true, videoQuiz: 'random', autoResume: true };
}
export function normalizeStudyPreferences(value: unknown): StudyPreferences {
  const result = defaultStudyPreferences();
  if (!value || typeof value !== 'object') return result;
  const input = value as Partial<StudyPreferences>;
  if (input.startMode === 'current-forward') result.startMode = input.startMode;
  if (typeof input.playbackRate === 'number' && STUDY_RATES.some(rate => rate === input.playbackRate)) result.playbackRate = input.playbackRate;
  if (typeof input.muted === 'boolean') result.muted = input.muted;
  if (input.videoQuiz === 'ignore') result.videoQuiz = 'ignore';
  if (typeof input.autoResume === 'boolean') result.autoResume = input.autoResume;
  return result;
}
export type StudyTaskType = 'video' | 'courseware' | 'audio-ppt' | 'book' | 'hyperlink' | 'chapter-test';
export interface StudyTask { key: string; type: StudyTaskType; title: string; jobId: string; isTaskPoint: boolean }
export interface StudyFrameSnapshot {
  documentKey: string; tasks: StudyTask[]; cardReady: boolean; warning?: string;
  chapterId?: string; attachmentJobIds?: string[];
}
export interface StudyTaskOutcome { status: 'acted' | 'skipped' | 'attention'; message: string; chapterIncomplete?: boolean }
export interface StudyTarget extends StudyTask { frameId: number; documentId?: string; documentKey: string }
export type StudyPageRequest =
  | { action: 'inspect' }
  | { action: 'configure'; preferences: StudyPreferences }
  | { action: 'run'; runId: string; taskKey: string; documentKey: string; preferences: StudyPreferences; verifiedJobId?: string; resumeOnly?: boolean }
  | { action: 'cancel'; runId: string }
  | { action: 'navigate'; chapterId: string; runId?: string }
  | { action: 'card'; cardIndex: number; runId?: string }
  | { action: 'refresh'; runId?: string };
export interface StudyPageResult { ok: boolean; error?: string; snapshot?: StudyFrameSnapshot; outcome?: StudyTaskOutcome; cacheMiss?: boolean }
export type StudyPhase = 'disabled' | 'unsupported' | 'waiting' | 'running' | 'confirming' | 'paused' | 'complete' | 'error';
export interface StudyState {
  phase: StudyPhase; running: boolean; message: string; chapterTitle: string; taskType?: StudyTaskType;
  completed: number; skipped: string[]; preferences: StudyPreferences;
}
export interface StudySession {
  courseKey: string; runId: string; anchorId: string; visited: string[]; skipped: string[];
  completed: number; paused: boolean; expectedChapterId?: string; finished?: boolean; startMode?: StudyStartMode;
}
export interface StudyController {
  getState(): StudyState;
  subscribe(listener: (state: StudyState) => void): () => void;
  start(): void;
  stop(): void;
  settingsChanged(): void;
  updatePreferences(preferences: StudyPreferences): Promise<void>;
  dispose(): void;
}
export interface StudyRuntime {
  scan(signal: AbortSignal): Promise<{ targets: StudyTarget[]; cardReady: boolean; warnings: string[] }>;
  runTask(target: StudyTarget, runId: string, preferences: StudyPreferences, signal: AbortSignal): Promise<StudyTaskOutcome>;
  page(request: StudyPageRequest, signal?: AbortSignal): Promise<StudyPageResult>;
  cancel(runId: string): void;
  configure(preferences: StudyPreferences): Promise<void>;
  readPreferences(): Promise<StudyPreferences>;
  writePreferences(preferences: StudyPreferences): Promise<void>;
  subscribePreferences(listener: (preferences: StudyPreferences) => void): () => void;
  readSession(courseKey: string): Promise<StudySession | undefined>;
  writeSession(session: StudySession): Promise<void>;
}
