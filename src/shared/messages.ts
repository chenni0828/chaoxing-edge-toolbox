import type { FeatureId } from '../features/catalog';
import type { ExtractedQuestion } from '../features/question-extract/extract';

export const EXTRACTION_PORT = 'toolbox:question-extraction:v1';
export const COLLECT_QUESTIONS = 'toolbox:collect-questions';
export const OPEN_PANEL = 'toolbox:open-panel';
export const OPEN_SETTINGS = 'toolbox:open-settings';

export interface PageStatus {
  ready: boolean;
  enabled: boolean;
  activeFeatures: FeatureId[];
  errors: string[];
}

export type ExtractionResponse = {
  ok: true;
  questions: ExtractedQuestion[];
  markdown: string;
  frameCount: number;
  warnings: string[];
} | {
  ok: false;
  error: string;
};

export interface FrameExtraction {
  type: 'toolbox:frame-result';
  frameKey: string;
  questions: ExtractedQuestion[];
  error?: string;
}
