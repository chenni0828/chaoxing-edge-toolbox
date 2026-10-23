import type { PageFeature } from '../core/feature-manager';
import { installAllowPaste } from './allow-paste';
import { installChapterStudy } from './chapter-study/page';
import { isFeatureSupported } from './catalog';
import type { PlatformId } from '../shared/sites';

/** Register MAIN-world features here. Pure DOM readers stay in the isolated world. */
export const PAGE_FEATURES: readonly PageFeature[] = [
  { id: 'allow-paste', install: installAllowPaste },
  { id: 'chapter-study', install: installChapterStudy },
];

export function getPageFeatures(platformId: PlatformId | undefined): readonly PageFeature[] {
  return PAGE_FEATURES.filter(feature => isFeatureSupported(feature.id, platformId));
}
