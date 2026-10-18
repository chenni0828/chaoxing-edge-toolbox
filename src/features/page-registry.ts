import type { PageFeature } from '../core/feature-manager';
import { installAllowPaste } from './allow-paste';
import { installChapterStudy } from './chapter-study/page';

/** Register MAIN-world features here. Pure DOM readers stay in the isolated world. */
export const PAGE_FEATURES: readonly PageFeature[] = [
  { id: 'allow-paste', install: installAllowPaste },
  { id: 'chapter-study', install: installChapterStudy },
];
