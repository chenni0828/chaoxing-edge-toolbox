export interface CurrentQuestion {
  key: string;
  fingerprint: string;
  type: '简答题';
  stem: string;
  knowledgePoints: string[];
  assessment: string;
}

export type PageQuestionState =
  | { state: 'question'; question: CurrentQuestion }
  | { state: 'waiting' | 'complete' | 'unsupported'; message: string };

export interface AnswerSnapshot {
  ready: boolean;
  text: string;
  version: string;
  hasContent: boolean;
  error?: string;
}

export interface AnswerWriteRequest {
  question: CurrentQuestion;
  expectedVersion: string;
  text: string;
}

export interface AnswerWriteResult {
  ok: boolean;
  error?: string;
}

export type AiPhase = 'paused' | 'waiting' | 'needs-config' | 'blocked' | 'generating' | 'filled' | 'complete' | 'unsupported' | 'error';

export interface AiAnswerState {
  phase: AiPhase;
  running: boolean;
  message: string;
  question?: CurrentQuestion;
  answer: string;
  canConfirmReplace: boolean;
}

export interface AiAnswerController {
  getState(): AiAnswerState;
  subscribe(listener: (state: AiAnswerState) => void): () => void;
  start(): void;
  stop(): void;
  confirmReplace(): void;
  retry(): void;
  settingsChanged(): void;
  dispose(): void;
}

export interface AiControllerDependencies {
  document: Document;
  isEnabled(): boolean;
  apiConfigured(): Promise<boolean>;
  readAnswer(): Promise<AnswerSnapshot>;
  writeAnswer(request: AnswerWriteRequest): Promise<AnswerWriteResult>;
  generate(question: CurrentQuestion, signal: AbortSignal, onProgress: (text: string) => void): Promise<string>;
}
